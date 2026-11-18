// src/data/npcConversations.js
// Generado por el lab de voces (4_llevar_al_juego.py): conversaciones entre dos peatones.
// Cada hablante pide sexo y edad; el audio está en public/audio/conversaciones/.
export const NPC_CONVERSATIONS = [
  {
    "id": "bus",
    "hablantes": {
      "A": {
        "sexo": "hombre",
        "edad": "adulto"
      },
      "B": {
        "sexo": "hombre",
        "edad": "joven"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "¿Hace cuánto está esperando el bus?",
        "file": "conv_bus_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "Como media hora, y nada que pasa.",
        "file": "conv_bus_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "Siempre es lo mismo a esta hora.",
        "file": "conv_bus_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Si no llega en cinco minutos, me voy caminando.",
        "file": "conv_bus_04.mp3"
      }
    ]
  },
  {
    "id": "camioneta",
    "hablantes": {
      "A": {
        "sexo": "mujer",
        "edad": "adulto"
      },
      "B": {
        "sexo": "hombre",
        "edad": "adulto"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "¿Usted vio la camioneta que pasó anoche?",
        "file": "conv_camioneta_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "No, ¿cuál camioneta?",
        "file": "conv_camioneta_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "Una oscura, sin placas. Dio dos vueltas por el parque.",
        "file": "conv_camioneta_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Mejor no hablemos de eso aquí en la calle.",
        "file": "conv_camioneta_04.mp3"
      }
    ]
  },
  {
    "id": "frio",
    "hablantes": {
      "A": {
        "sexo": "hombre",
        "edad": "mayor"
      },
      "B": {
        "sexo": "mujer",
        "edad": "joven"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "Buenas noches, mija. ¿No tiene frío así?",
        "file": "conv_frio_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "Un poquito, pero ya voy llegando a la casa.",
        "file": "conv_frio_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "Cuídese, que por aquí de noche es delicado.",
        "file": "conv_frio_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Gracias, don. Usted también se cuida.",
        "file": "conv_frio_04.mp3"
      }
    ]
  },
  {
    "id": "futbol",
    "hablantes": {
      "A": {
        "sexo": "hombre",
        "edad": "joven"
      },
      "B": {
        "sexo": "hombre",
        "edad": "adulto"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "¿Vio el partido de anoche?",
        "file": "conv_futbol_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "Claro, qué robo tan descarado ese penalti.",
        "file": "conv_futbol_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "No, hermano, ese penalti sí era.",
        "file": "conv_futbol_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Usted porque es hincha del otro equipo.",
        "file": "conv_futbol_04.mp3"
      }
    ]
  },
  {
    "id": "lluvia",
    "hablantes": {
      "A": {
        "sexo": "mujer",
        "edad": "adulto"
      },
      "B": {
        "sexo": "hombre",
        "edad": "adulto"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "¿Usted cree que va a llover otra vez?",
        "file": "conv_lluvia_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "Uy, sí. Mire cómo está de negro para los cerros.",
        "file": "conv_lluvia_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "Qué pereza. Y yo sin sombrilla.",
        "file": "conv_lluvia_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Pues métase aquí debajo mientras escampa.",
        "file": "conv_lluvia_04.mp3"
      }
    ]
  },
  {
    "id": "olor",
    "hablantes": {
      "A": {
        "sexo": "hombre",
        "edad": "adulto"
      },
      "B": {
        "sexo": "mujer",
        "edad": "adulto"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "Uy, ¿sí siente ese olor?",
        "file": "conv_olor_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "Es la basura de la esquina, que no la han recogido.",
        "file": "conv_olor_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "Ya van como tres días.",
        "file": "conv_olor_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Y con esta lluvia peor todavía.",
        "file": "conv_olor_04.mp3"
      }
    ]
  },
  {
    "id": "perro",
    "hablantes": {
      "A": {
        "sexo": "mujer",
        "edad": "mayor"
      },
      "B": {
        "sexo": "hombre",
        "edad": "joven"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "¿Ese perrito es suyo?",
        "file": "conv_perro_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "No, señora, anda por aquí todos los días.",
        "file": "conv_perro_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "Pobrecito, se ve flaquito.",
        "file": "conv_perro_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Dicen que el señor del cambuche le da comida.",
        "file": "conv_perro_04.mp3"
      }
    ]
  },
  {
    "id": "precios",
    "hablantes": {
      "A": {
        "sexo": "mujer",
        "edad": "mayor"
      },
      "B": {
        "sexo": "mujer",
        "edad": "adulto"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "¿Ya vio a cómo está la libra de papa?",
        "file": "conv_precios_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "Ni me diga. Todo subió otra vez esta semana.",
        "file": "conv_precios_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "Con lo de la pensión ya no alcanza para nada.",
        "file": "conv_precios_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Toca ir a la plaza temprano, que allá sale más barato.",
        "file": "conv_precios_04.mp3"
      }
    ]
  },
  {
    "id": "recuerdos",
    "hablantes": {
      "A": {
        "sexo": "hombre",
        "edad": "mayor"
      },
      "B": {
        "sexo": "mujer",
        "edad": "mayor"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "¿Se acuerda cuando por aquí pasaba el tranvía?",
        "file": "conv_recuerdos_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "Uy, eso fue hace muchísimos años.",
        "file": "conv_recuerdos_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "La ciudad era chiquitica y tranquila.",
        "file": "conv_recuerdos_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Ahora uno ni conoce a los vecinos.",
        "file": "conv_recuerdos_04.mp3"
      }
    ]
  },
  {
    "id": "trabajo",
    "hablantes": {
      "A": {
        "sexo": "mujer",
        "edad": "joven"
      },
      "B": {
        "sexo": "mujer",
        "edad": "adulto"
      }
    },
    "lineas": [
      {
        "hablante": "A",
        "texto": "¿Y qué, consiguió el trabajo en el centro?",
        "file": "conv_trabajo_01.mp3"
      },
      {
        "hablante": "B",
        "texto": "Todavía no me han llamado.",
        "file": "conv_trabajo_02.mp3"
      },
      {
        "hablante": "A",
        "texto": "Tranquila, que eso se demoran.",
        "file": "conv_trabajo_03.mp3"
      },
      {
        "hablante": "B",
        "texto": "Ojalá, porque el arriendo no espera.",
        "file": "conv_trabajo_04.mp3"
      }
    ]
  }
];
