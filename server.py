import os
import time
import datetime
import threading
import cv2
from fastapi import FastAPI, Depends
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from ultralytics import YOLO

DATABASE_URL = "sqlite:///./spatial_search.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class SpatialLog(Base):
    __tablename__ = "spatial_logs"
    id = Column(Integer, primary_key=True, index=True)
    object_name = Column(String)
    x_coord = Column(Float)
    y_coord = Column(Float)
    w_coord = Column(Float)
    h_coord = Column(Float)
    confidence = Column(Float)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    image_filename = Column(String)

Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

model = YOLO("model.pt")

VIDEO_PATH = "demo.mp4"
cap = cv2.VideoCapture(VIDEO_PATH)

latest_frame = None
annotated_frame = None

SCAN_INTERVAL = 5
PLAYBACK_SPEED = 75

CONFIDENCE_THRESHOLDS = {
    "Keys": 0.55,
    "Wallet": 0.01,
    "Default": 0.60
}

last_save_time = time.time()
video_remaining_sec = 0
total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
fps = cap.get(cv2.CAP_PROP_FPS) or 30

def capture_loop():
    global latest_frame, video_remaining_sec

    while True:
        ret, frame = cap.read()

        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        current_frame = cap.get(cv2.CAP_PROP_POS_FRAMES)
        cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame + (PLAYBACK_SPEED - 1))

        rem_frames = total_frames - current_frame
        video_remaining_sec = int((rem_frames / fps) / PLAYBACK_SPEED)

        frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
        latest_frame = frame.copy()

        time.sleep(1 / fps)

threading.Thread(target=capture_loop, daemon=True).start()

def detection_loop():
    global annotated_frame, last_save_time
    db = SessionLocal()

    while True:
        if latest_frame is not None:
            frame_to_process = latest_frame.copy()
            results = model(frame_to_process, verbose=False)

            annotated_frame = results[0].plot()

            best_detections = {}

            for box in results[0].boxes:
                label = model.names[int(box.cls[0])].title()
                conf = float(box.conf[0])

                threshold = CONFIDENCE_THRESHOLDS.get(label, CONFIDENCE_THRESHOLDS["Default"])

                if conf >= threshold:
                    if label not in best_detections or conf > best_detections[label]["conf"]:
                        best_detections[label] = {
                            "box": box,
                            "conf": conf
                        }

            current_time = time.time()
            if current_time - last_save_time >= SCAN_INTERVAL:

                if best_detections:
                    ts = int(current_time)
                    fname = f"snap_{ts}.jpg"
                    filepath = os.path.join(UPLOAD_DIR, fname)
                    cv2.imwrite(filepath, frame_to_process)

                    for label, data in best_detections.items():
                        box = data["box"]
                        conf = data["conf"]

                        x1, y1, x2, y2 = box.xyxyn[0].tolist()

                        db.add(SpatialLog(
                            object_name=label,
                            x_coord=round(x1 * 100, 2),
                            y_coord=round(y1 * 100, 2),
                            w_coord=round((x2 - x1) * 100, 2),
                            h_coord=round((y2 - y1) * 100, 2),
                            confidence=round(conf, 4),
                            image_filename=fname
                        ))

                    db.commit()

                last_save_time = current_time

        time.sleep(0.05)

threading.Thread(target=detection_loop, daemon=True).start()

def generate_frames(annotated=False):
    while True:
        frame_to_stream = annotated_frame if annotated else latest_frame

        if frame_to_stream is not None:
            _, buffer = cv2.imencode('.jpg', frame_to_stream)
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n' +
                buffer.tobytes() +
                b'\r\n'
            )

        time.sleep(0.05)

@app.get("/api/stream")
def video_feed(annotated: bool = False):
    return StreamingResponse(
        generate_frames(annotated),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.get("/api/status")
def get_status():
    elapsed = time.time() - last_save_time
    remaining_sec = max(0.0, SCAN_INTERVAL - elapsed)
    remaining_ms = int(remaining_sec * 1000)

    return {
        "scan_remaining_ms": remaining_ms,
        "video_remaining_sec": video_remaining_sec
    }

@app.get("/api/data")
def get_data(db: Session = Depends(get_db)):
    logs = db.query(SpatialLog).order_by(SpatialLog.timestamp.asc()).all()

    grouped_data = {}
    for log in logs:
        if log.object_name not in grouped_data:
            grouped_data[log.object_name] = {"name": log.object_name, "history": []}

        grouped_data[log.object_name]["history"].append({
            "time": log.timestamp.strftime("%H:%M:%S"),
            "date": log.timestamp.strftime("%Y-%m-%d"),
            "x": log.x_coord,
            "y": log.y_coord,
            "w": log.w_coord,
            "h": log.h_coord,
            "conf": log.confidence,
            "img": f"http://127.0.0.1:8000/uploads/{log.image_filename}"
        })

    return list(grouped_data.values())

@app.post("/api/reset")
def reset_data(db: Session = Depends(get_db)):
    db.query(SpatialLog).delete()
    db.commit()
    for file in os.listdir(UPLOAD_DIR):
        os.remove(os.path.join(UPLOAD_DIR, file))
    return {"status": "cleared"}

@app.get("/")
def serve_index():
    return FileResponse("index.html")

@app.get("/style.css")
def serve_css():
    return FileResponse("style.css")

@app.get("/script.js")
def serve_js():
    return FileResponse("script.js")
