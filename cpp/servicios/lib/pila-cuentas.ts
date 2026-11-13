// La pila "BazukoCuentas": grupo de usuarios de Cognito con su disparador de nombres, tablas de DynamoDB y el HTTP API con autorizador JWT.
// Las rutas de cada historia (perfil, clasificacion, amigos, chat) se agregan con `ruta()` a medida que se implementan.
import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';

export interface PilaCuentasProps extends StackProps {
  correoAlertas?: string;   // a donde llega el aviso del presupuesto (opcional; se pasa con -c correoAlertas=...)
}

export class PilaCuentas extends Stack {
  readonly grupo: cognito.UserPool;
  readonly cliente: cognito.UserPoolClient;
  readonly api: apigw.HttpApi;
  readonly tablas: Record<string, dynamodb.Table> = {};

  constructor(scope: Construct, id: string, props: PilaCuentasProps = {}) {
    super(scope, id, props);

    // --- Cuentas: Cognito guarda y compara las contrasenas; nada nuestro las ve (FR-009) ---
    const preRegistro = this.funcion('PreRegistro', 'disparadores/preRegistro.ts');
    this.grupo = new cognito.UserPool(this, 'Jugadores', {
      userPoolName: 'bazuko-jugadores',
      selfSignUpEnabled: true,
      signInAliases: { username: true },
      signInCaseSensitive: false,                            // "Jairo" y "jairo" son la misma cuenta (FR-002)
      standardAttributes: { email: { required: false, mutable: true } },
      autoVerify: { email: false },                          // el correo se verifica a pedido, desde el perfil (FR-008a)
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,   // sin correo verificado no hay recuperacion (FR-008b)
      passwordPolicy: {
        minLength: 8, requireLowercase: false, requireUppercase: false, requireDigits: false, requireSymbols: false,
        tempPasswordValidity: Duration.days(3),
      },
      mfa: cognito.Mfa.OFF,
      lambdaTriggers: { preSignUp: preRegistro },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.cliente = this.grupo.addClient('Juego', {
      userPoolClientName: 'bazuko-juego',
      generateSecret: false,                                 // cliente publico: el juego no puede guardar un secreto
      authFlows: { userPassword: true, userSrp: true },
      preventUserExistenceErrors: true,                      // "usuario o contrasena incorrectos" sin decir cual (US1)
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({ email: true, emailVerified: true }),
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({ email: true }),
    });
    // plan Lite del grupo (el mas barato; alcanza para usuario y contrasena). Esta version de CDK no trae `featurePlan`: va directo a CloudFormation
    (this.grupo.node.defaultChild as cognito.CfnUserPool).addPropertyOverride('UserPoolTier', 'LITE');

    // --- Tablas (data-model.md) ---
    this.tabla('Perfiles', 'cuenta').addGlobalSecondaryIndex({ indexName: 'porNombre', partitionKey: { name: 'nombreMin', type: dynamodb.AttributeType.STRING } });
    const estadisticas = this.tabla('Estadisticas', 'cuenta');
    for (const campo of ['dias', 'plata', 'peleas', 'partidas', 'tiempo']) {
      estadisticas.addGlobalSecondaryIndex({
        indexName: `por_${campo}`,
        partitionKey: { name: 'tabla', type: dynamodb.AttributeType.STRING },
        sortKey: { name: campo, type: dynamodb.AttributeType.NUMBER },
        projectionType: dynamodb.ProjectionType.INCLUDE,
        nonKeyAttributes: ['nombre'],
      });
    }
    this.tabla('Amistades', 'cuenta', 'otra');
    this.tabla('Conexiones', 'conexionId', undefined, 'vence')
      .addGlobalSecondaryIndex({ indexName: 'porCuenta', partitionKey: { name: 'cuenta', type: dynamodb.AttributeType.STRING } });
    this.tabla('Presencia', 'cuenta', undefined, 'vence');
    this.tabla('Mensajes', 'canal', 'enviado', 'vence');
    this.tabla('Pendientes', 'cuenta', 'enviado', 'vence');
    this.tabla('Partidas', 'partida', 'cuenta', 'vence');
    this.tabla('Limites', 'clave', undefined, 'vence');

    // --- HTTP API: el autorizador JWT rechaza lo que no sea un token vigente del grupo y del cliente del juego (FR-013) ---
    const autorizador = new HttpJwtAuthorizer('Jugador', `https://cognito-idp.${this.region}.amazonaws.com/${this.grupo.userPoolId}`, {
      jwtAudience: [this.cliente.userPoolClientId],
      identitySource: ['$request.header.Authorization'],
    });
    this.api = new apigw.HttpApi(this, 'Social', { apiName: 'bazuko-social', defaultAuthorizer: autorizador, createDefaultStage: true });
    const etapa = this.api.defaultStage?.node.defaultChild as apigw.CfnStage | undefined;
    if (etapa) etapa.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 };

    // --- Perfil (US2): el propio y el publico de otros ---
    const yo = this.funcion('Yo', 'http/yo.ts');
    for (const metodo of [apigw.HttpMethod.GET, apigw.HttpMethod.PUT, apigw.HttpMethod.DELETE])
      this.ruta(metodo, '/yo', yo, ['Perfiles', 'Estadisticas', 'Amistades', 'Pendientes', 'Presencia', 'Limites']);
    const jugadores = this.funcion('BuscarJugador', 'http/jugadores.ts');
    this.ruta(apigw.HttpMethod.GET, '/jugadores/{nombre}', jugadores, ['Perfiles', 'Estadisticas', 'Amistades', 'Presencia', 'Limites']);

    // --- Clasificacion (US3): el anfitrion informa, el servidor acredita solo lo posible, y cualquiera con cuenta ve las tablas ---
    const partidas = this.funcion('InformePartida', 'http/partidas.ts');
    this.ruta(apigw.HttpMethod.POST, '/partidas/{codigo}/{accion}', partidas, ['Perfiles', 'Estadisticas', 'Partidas', 'Limites']);
    const clasificacion = this.funcion('VerClasificacion', 'http/clasificacion.ts');
    this.ruta(apigw.HttpMethod.GET, '/clasificacion/{tabla}', clasificacion, ['Estadisticas', 'Limites']);

    // --- Presupuesto: aviso si el mes pasa del 80 % de 5 USD ---
    if (props.correoAlertas) {
      new budgets.CfnBudget(this, 'Presupuesto', {
        budget: { budgetName: 'bazuko-cuentas', budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: 5, unit: 'USD' } },
        notificationsWithSubscribers: [{
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.correoAlertas }],
        }],
      });
    }

    new CfnOutput(this, 'Region', { value: this.region });
    new CfnOutput(this, 'GrupoUsuarios', { value: this.grupo.userPoolId });
    new CfnOutput(this, 'ClienteJuego', { value: this.cliente.userPoolClientId });
    new CfnOutput(this, 'ApiHttp', { value: this.api.apiEndpoint });
  }

  // Una Lambda de Node.js 22 en arm64 con su grupo de registros de 14 dias
  funcion(nombre: string, archivo: string, extra: Partial<NodejsFunctionProps> = {}): NodejsFunction {
    const registros = new logs.LogGroup(this, `${nombre}Registros`, { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY });
    return new NodejsFunction(this, nombre, {
      entry: path.join(__dirname, '..', 'src', archivo),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup: registros,
      bundling: { minify: true, sourceMap: false, target: 'node22' },
      ...extra,
    });
  }

  // Una tabla bajo demanda, cifrada, que se conserva si se borra la pila
  tabla(nombre: string, pk: string, sk?: string, ttl?: string): dynamodb.Table {
    const t = new dynamodb.Table(this, nombre, {
      tableName: `bazuko-${nombre.toLowerCase()}`,
      partitionKey: { name: pk, type: dynamodb.AttributeType.STRING },
      sortKey: sk ? { name: sk, type: dynamodb.AttributeType.STRING } : undefined,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: ttl,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.tablas[nombre] = t;
    return t;
  }

  // Una ruta del HTTP API con su Lambda, que puede leer y escribir las tablas indicadas
  ruta(metodo: apigw.HttpMethod, camino: string, fn: NodejsFunction, tablas: string[]) {
    for (const nombre of tablas) {
      this.tablas[nombre].grantReadWriteData(fn);
      fn.addEnvironment(`TABLA_${nombre.toUpperCase()}`, this.tablas[nombre].tableName);
    }
    this.api.addRoutes({ path: camino, methods: [metodo], integration: new HttpLambdaIntegration(`${fn.node.id}${metodo}`, fn) });
  }
}
