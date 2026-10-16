import os
os.environ.setdefault("YOLO_AUTOINSTALL", "False")

import cv2
import argparse
import threading
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import uvicorn

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state for API
traffic_stats_lock = threading.Lock()
traffic_stats = {
    "entered": 0,
    "exited": 0,
    "current_cars": 0,
    "total_spaces": 50,
    "is_running": False,
    "error": None,
    "started_at": None,
    "last_frame_at": None,
}

def run_vision_model(source, model_path, line_ratio, direction, conf, spaces):
    global traffic_stats

    if source.isdigit():
        source = int(source)

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        with traffic_stats_lock:
            traffic_stats["is_running"] = False
            traffic_stats["error"] = f"영상 소스를 열 수 없습니다: {source}"
        print(f"Error opening video source: {source}")
        return

    try:
        print(f"Loading YOLO model... path={model_path}")
        model = YOLO(str(model_path))
    except Exception:
        cap.release()
        with traffic_stats_lock:
            traffic_stats["is_running"] = False
            traffic_stats["error"] = f"모델을 불러오지 못했습니다: {model_path}"
        return

    video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    if video_height == 0:
        video_height = 480
    COUNTING_LINE_Y = int(video_height * line_ratio)

    track_history = {}
    with traffic_stats_lock:
        traffic_stats["total_spaces"] = spaces
        traffic_stats["is_running"] = True
        traffic_stats["error"] = None
        traffic_stats["started_at"] = datetime.now(timezone.utc).isoformat()
        traffic_stats["last_frame_at"] = None
    print("Vision model processing started in background.")

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            continue
        with traffic_stats_lock:
            traffic_stats["last_frame_at"] = datetime.now(timezone.utc).isoformat()

        results = model.track(
            frame, 
            classes=[2, 3, 5, 7], 
            conf=conf, 
            iou=0.4,                  
            persist=True, 
            tracker="bytetrack.yaml", 
            verbose=False
        )

        if results[0].boxes.id is not None:
            boxes = results[0].boxes.xyxy.cpu().numpy()
            track_ids = results[0].boxes.id.cpu().numpy()

            for box, track_id in zip(boxes, track_ids):
                x1, y1, x2, y2 = map(int, box)
                center_y = int((y1 + y2) / 2)

                if track_id in track_history:
                    prev_y = track_history[track_id]
                    is_entered = False
                    is_exited = False

                    if direction == 'up_to_down':
                        if prev_y < COUNTING_LINE_Y and center_y >= COUNTING_LINE_Y:
                            is_entered = True
                        elif prev_y > COUNTING_LINE_Y and center_y <= COUNTING_LINE_Y:
                            is_exited = True
                    elif direction == 'down_to_up':
                        if prev_y > COUNTING_LINE_Y and center_y <= COUNTING_LINE_Y:
                            is_entered = True
                        elif prev_y < COUNTING_LINE_Y and center_y >= COUNTING_LINE_Y:
                            is_exited = True

                    if is_entered:
                        with traffic_stats_lock:
                            traffic_stats["entered"] += 1
                            traffic_stats["current_cars"] += 1
                            entered = traffic_stats["entered"]
                        print(f"Car Entered! ID: {track_id}, Total IN: {entered}")
                    elif is_exited:
                        with traffic_stats_lock:
                            traffic_stats["exited"] += 1
                            traffic_stats["current_cars"] = max(0, traffic_stats["current_cars"] - 1)
                            exited = traffic_stats["exited"]
                        print(f"Car Exited! ID: {track_id}, Total OUT: {exited}")

                track_history[track_id] = center_y
    cap.release()
    with traffic_stats_lock:
        traffic_stats["is_running"] = False

@app.get("/api/traffic")
def get_traffic_stats():
    with traffic_stats_lock:
        return traffic_stats.copy()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=str, default='0', help='Camera index (e.g. 0) or stream URL')
    parser.add_argument('--model', type=Path, default=Path(__file__).resolve().parent / 'car_vision_model' / 'yolov8s.pt')
    parser.add_argument('--host', type=str, default='0.0.0.0')
    parser.add_argument('--line', type=float, default=0.5)
    parser.add_argument('--direction', type=str, default='up_to_down')
    parser.add_argument('--conf', type=float, default=0.4)
    parser.add_argument('--spaces', type=int, default=50)
    parser.add_argument('--port', type=int, default=8001)
    args = parser.parse_args()

    t = threading.Thread(target=run_vision_model, args=(args.source, args.model, args.line, args.direction, args.conf, args.spaces))
    t.daemon = True
    t.start()

    print(f"Starting API server on port {args.port}...")
    uvicorn.run(app, host=args.host, port=args.port)
