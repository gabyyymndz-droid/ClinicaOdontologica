import os
import json
import requests
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, Request, HTTPException, Query
from fastapi.responses import PlainTextResponse
import firebase_admin
from firebase_admin import credentials, firestore
from apscheduler.schedulers.background import BackgroundScheduler
from contextlib import asynccontextmanager

# 1. Inicializar Firebase
firebase_env = os.getenv("FIREBASE_CREDENTIALS")
if firebase_env and not firebase_admin._apps:
    cert = json.loads(firebase_env)
    cred = credentials.Certificate(cert)
    firebase_admin.initialize_app(cred)

db = firestore.client() if firebase_admin._apps else None

# 2. Variables de entorno
WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN")
WHATSAPP_PHONE_ID = os.getenv("WHATSAPP_PHONE_ID")
WEBHOOK_VERIFY_TOKEN = os.getenv("WEBHOOK_VERIFY_TOKEN", "smilecare_webhook_2026")
TEMPLATE_NAME = "recordatorio_cita"

def limpiar_telefono(tel: str) -> str:
    return "".join(filter(str.isdigit, str(tel)))

def enviar_whatsapp(telefono, nombre, fecha_str):
    url = f"https://graph.facebook.com/v17.0/{WHATSAPP_PHONE_ID}/messages"
    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json"
    }
    data = {
        "messaging_product": "whatsapp",
        "to": telefono,
        "type": "template",
        "template": {
            "name": TEMPLATE_NAME,
            "language": {"code": "es"},
            "components": [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": nombre},
                        {"type": "text", "text": fecha_str}
                    ]
                }
            ]
        }
    }
    respuesta = requests.post(url, headers=headers, json=data)
    print(f"Recordatorio enviado a {telefono}: HTTP {respuesta.status_code}")

def enviar_respuesta_simple(telefono, texto):
    url = f"https://graph.facebook.com/v17.0/{WHATSAPP_PHONE_ID}/messages"
    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json"
    }
    data = {
        "messaging_product": "whatsapp",
        "to": telefono,
        "type": "text",
        "text": {"body": texto}
    }
    requests.post(url, headers=headers, json=data)

# 3. Tarea programada: enviar recordatorios 24h antes
def procesar_recordatorios():
    if not db:
        return

    ahora = datetime.now(timezone.utc)
    inicio_busqueda = ahora + timedelta(hours=24)
    fin_busqueda = inicio_busqueda + timedelta(hours=1)

    query = (
        db.collection("appointments")
        .where("fecha", ">=", inicio_busqueda)
        .where("fecha", "<=", fin_busqueda)
    )

    for doc in query.stream():
        cita = doc.to_dict()
        if not cita.get("recordatorio_enviado"):
            fecha_cita = cita["fecha"].strftime("%d/%m/%Y a las %H:%M")
            tel_limpio = limpiar_telefono(cita.get("telefono", ""))
            if tel_limpio:
                enviar_whatsapp(tel_limpio, cita["nombre"], fecha_cita)
                doc.reference.update({
                    "recordatorio_enviado": True,
                    "estado": "pendiente_confirmacion"
                })

# 4. Configurar el reloj interno e instancia de FastAPI
@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(procesar_recordatorios, "interval", hours=1)
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)

# 5. Rutas del servidor y Webhook
@app.get("/")
def health_check():
    return {"estado": "SmileCare Backend activo"}

@app.get("/webhook")
def verificar_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge")
):
    if hub_mode == "subscribe" and hub_verify_token == WEBHOOK_VERIFY_TOKEN:
        return PlainTextResponse(content=hub_challenge, status_code=200)
    raise HTTPException(status_code=403, detail="Token de verificación inválido")

@app.post("/webhook")
async def recibir_mensaje_whatsapp(request: Request):
    body = await request.json()

    try:
        entries = body.get("entry", [])
        for entry in entries:
            for change in entry.get("changes", []):
                value = change.get("value", {})
                messages = value.get("messages", [])

                for msg in messages:
                    telefono_remitente = limpiar_telefono(msg.get("from", ""))
                    tipo = msg.get("type")

                    texto_respuesta = ""
                    if tipo == "text":
                        texto_respuesta = msg["text"]["body"].strip().lower()
                    elif tipo == "button":
                        texto_respuesta = msg["button"]["text"].strip().lower()

                    palabras_confirmacion = ["si", "sí", "confirmo", "confirmar", "ok", "dale", "listo"]
                    if any(palabra in texto_respuesta for palabra in palabras_confirmacion) and db:
                        confirmar_cita_en_firebase(telefono_remitente)

    except Exception as e:
        print(f"Error procesando webhook: {e}")

    return {"status": "ok"}

def confirmar_cita_en_firebase(telefono_paciente: str):
    citas = db.collection("appointments").where("recordatorio_enviado", "==", True).stream()

    for doc in citas:
        datos = doc.to_dict()
        tel_bd = limpiar_telefono(datos.get("telefono", ""))
        
        if tel_bd == telefono_paciente and datos.get("estado") != "confirmada":
            doc.reference.update({
                "estado": "confirmada",
                "confirmada": True
            })
            enviar_respuesta_simple(
                telefono_paciente,
                f"¡Gracias {datos.get('nombre', '')}! Tu cita en SmileCare ha quedado confirmada."
            )
            print(f"Cita {doc.id} confirmada para {telefono_paciente}")
            break
