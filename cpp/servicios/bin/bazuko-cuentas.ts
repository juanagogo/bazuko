#!/usr/bin/env node
// App CDK de las cuentas y funciones sociales. Todo va en la region del proyecto (us-east-2) y en la cuenta del perfil con que se despliega.
import { App } from 'aws-cdk-lib';
import { PilaCuentas } from '../lib/pila-cuentas';

const app = new App();
new PilaCuentas(app, 'BazukoCuentas', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-2' },
  description: 'Bazuko: cuentas de jugador, perfil, clasificacion, amigos y chat',
  correoAlertas: app.node.tryGetContext('correoAlertas'),
});
