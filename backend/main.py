import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="FocusPulse API", version="1.0.0")

# CORS: permitir peticiones desde extensiones de Chrome, localhost y cualquier origen
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",                        # Cualquier origen público
        "chrome-extension://*",     # Extensiones de Chrome
        "http://localhost:*",       # Servidor local cualquier puerto
        "http://127.0.0.1:*",      # Servidor local IP
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Base de datos en memoria: { email: { dominio: segundos_acumulados } }
db: dict[str, dict[str, int]] = {}


class TrackRequest(BaseModel):
    usuario_id: str  # email del usuario (ej: correo@gmail.com)
    dominio: str
    segundos: int


@app.post("/api/track")
def track_time(request: TrackRequest):
    """
    Recibe datos de tracking y acumula el tiempo por dominio para un email específico.
    - usuario_id: correo electrónico del usuario autenticado con Google.
    - dominio: sitio web visitado.
    - segundos: tiempo acumulado en ese dominio.
    """
    email = request.usuario_id.strip().lower()

    if email not in db:
        db[email] = {}

    user_data = db[email]
    user_data[request.dominio] = user_data.get(request.dominio, 0) + request.segundos

    return {
        "status": "ok",
        "usuario_id": email,
        "dominio": request.dominio,
        "total_segundos": user_data[request.dominio],
    }


@app.get("/api/stats/{usuario_id:path}")
def get_stats(usuario_id: str):
    """
    Devuelve el resumen de segundos acumulados por dominio para un email específico.
    Usa :path para aceptar emails con puntos (ej: usuario@gmail.com) sin truncar.
    Si el usuario no existe o no tiene datos, retorna un diccionario vacío con código 200.
    """
    email = usuario_id.strip().lower()

    if email not in db:
        return {"usuario_id": email, "datos": {}}

    return {"usuario_id": email, "datos": db[email]}


# --- Servir archivos estáticos del Dashboard ---
# La carpeta /dashboard está un nivel arriba del backend
dashboard_path = Path(__file__).resolve().parent.parent / "dashboard"
app.mount("/", StaticFiles(directory=str(dashboard_path), html=True), name="dashboard")
