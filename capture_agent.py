import argparse, json, os, time, tkinter as tk
from pathlib import Path

import cv2
import mss
import numpy as np
import pytesseract

CONFIG = Path(__file__).with_name("capture_region.json")
COLORS = {
    "red":    ((0, 10), (150, 255), (70, 255)),
    "orange": ((8, 25), (100, 255), (70, 255)),
    "gold":   ((20, 38), (80, 255), (70, 255)),
    "green":  ((38, 85), (70, 255), (50, 255)),
    "blue":   ((85, 135), (70, 255), (50, 255)),
    "purple": ((135, 170), (50, 255), (45, 255)),
}

TEXT_TO_COLOR = {
    "red":"red","rot":"red","rojo":"red","rouge":"red","rosso":"red","vermelho":"red","красный":"red",
    "orange":"orange","orange":"orange","naranja":"orange","arancione":"orange","oranje":"orange",
    "gold":"gold","gelb":"gold","amarillo":"gold","jaune":"gold","giallo":"gold",
    "green":"green","grün":"green","verde":"green","vert":"green","verde":"green",
    "blue":"blue","blau":"blue","azul":"blue","bleu":"blue","blu":"blue",
    "purple":"purple","lila":"purple","violet":"purple","violett":"purple","morado":"purple","viola":"purple"
}

def choose_region():
    root = tk.Tk()
    root.attributes("-fullscreen", True)
    root.attributes("-alpha", 0.25)
    root.configure(bg="black")
    canvas = tk.Canvas(root, cursor="cross", bg="black", highlightthickness=0)
    canvas.pack(fill="both", expand=True)

    start = [None]
    rect = [None]
    result = [None]

    def down(e):
        start[0] = (e.x, e.y)
        if rect[0]:
            canvas.delete(rect[0])
        rect[0] = canvas.create_rectangle(e.x, e.y, e.x, e.y, outline="red", width=3)

    def move(e):
        if start[0] and rect[0]:
            canvas.coords(rect[0], start[0][0], start[0][1], e.x, e.y)

    def up(e):
        if not start[0]:
            return
        x1, y1 = start[0]
        x2, y2 = e.x, e.y
        left, top = min(x1,x2), min(y1,y2)
        width, height = abs(x2-x1), abs(y2-y1)
        if width > 10 and height > 10:
            result[0] = {"left": left, "top": top, "width": width, "height": height}
            root.destroy()

    canvas.bind("<ButtonPress-1>", down)
    canvas.bind("<B1-Motion>", move)
    canvas.bind("<ButtonRelease-1>", up)
    root.bind("<Escape>", lambda e: root.destroy())
    root.mainloop()

    if result[0]:
        CONFIG.write_text(json.dumps(result[0], indent=2), encoding="utf-8")
        print("Saved region:", result[0])

def get_region():
    if not CONFIG.exists():
        choose_region()
    if not CONFIG.exists():
        raise RuntimeError("No capture region selected.")
    return json.loads(CONFIG.read_text(encoding="utf-8"))

def detect(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    scores = {}
    total = frame.shape[0] * frame.shape[1]
    for name, ((h1,h2),(s1,s2),(v1,v2)) in COLORS.items():
        mask = cv2.inRange(hsv, (h1,s1,v1), (h2,s2,v2))
        scores[name] = float(cv2.countNonZero(mask)) / max(1,total)

    found = [k for k,v in scores.items() if v >= 0.015]

    # OCR is secondary: text can confirm a color even when the background shade is unusual.
    try:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, None, fx=2, fy=2)
        text = pytesseract.image_to_string(gray, config="--psm 6")
        normalized = " ".join(text.lower().split())
        for word, color in TEXT_TO_COLOR.items():
            if word in normalized:
                if color not in found:
                    found.append(color)
    except Exception:
        pass

    return found

def watch():
    region = get_region()
    with mss.mss() as sct:
        last = set()
        while True:
            shot = np.array(sct.grab(region))
            frame = cv2.cvtColor(shot, cv2.COLOR_BGRA2BGR)
            current = set(detect(frame))

            for color in sorted(current - last):
                print(json.dumps({"type":"color","color":color}), flush=True)
            last = current
            time.sleep(0.5)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--select", action="store_true")
    ap.add_argument("--watch", action="store_true")
    args = ap.parse_args()

    if args.select:
        choose_region()
    elif args.watch:
        watch()
    else:
        ap.print_help()
