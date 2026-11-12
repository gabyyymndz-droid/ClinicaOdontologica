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
            tel_limpio = limpiar