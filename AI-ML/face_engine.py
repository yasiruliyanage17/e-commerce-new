"""
Face Recognition Engine — DeepFace SFace wrapper
Uses opencv detector for proper face detection & alignment.
"""

import numpy as np
import cv2
import base64
import logging
from io import BytesIO
from PIL import Image

logger = logging.getLogger("face_engine")

# Lazy-loaded model reference
_model = None

# Use opencv for real face detection & alignment (lightweight, accurate)
DETECTOR_BACKEND = "opencv"


def _get_model():
    """Load SFace model once (lazy singleton)."""
    global _model
    if _model is None:
        logger.info("Loading DeepFace SFace model (first call)...")
        from deepface import DeepFace

        # Force model download / cache by running a dummy representation
        _dummy = np.zeros((160, 160, 3), dtype=np.uint8)
        try:
            DeepFace.represent(
                img_path=_dummy,
                model_name="SFace",
                enforce_detection=False,
                detector_backend="skip",
            )
        except Exception:
            pass  # model is now cached in memory
        _model = DeepFace
        logger.info("SFace model loaded successfully.")
    return _model


def _decode_base64_image(b64_string: str) -> np.ndarray:
    """Decode a base64 image string to a BGR numpy array (original size)."""
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]

    raw = base64.b64decode(b64_string)
    pil_img = Image.open(BytesIO(raw)).convert("RGB")
    arr = np.array(pil_img)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def generate_embedding(b64_image: str) -> list:
    """Generate a 128-d face embedding from a base64 image."""
    model = _get_model()
    img = _decode_base64_image(b64_image)

    results = model.represent(
        img_path=img,
        model_name="SFace",
        enforce_detection=False,
        detector_backend=DETECTOR_BACKEND,
    )

    if not results or len(results) == 0:
        raise ValueError("No face detected in image")

    return results[0]["embedding"]


def cosine_similarity(vec_a: list, vec_b: list) -> float:
    """Compute cosine similarity between two embedding vectors."""
    a = np.array(vec_a, dtype=np.float64)
    b = np.array(vec_b, dtype=np.float64)
    dot = np.dot(a, b)
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    if norm == 0:
        return 0.0
    return float(dot / norm)


def verify_face(b64_image: str, stored_embedding: list, threshold: float = 0.45) -> dict:
    """
    Compare a live face image against a stored embedding.
    Returns { verified, similarity, threshold }.
    """
    live_embedding = generate_embedding(b64_image)
    similarity = cosine_similarity(live_embedding, stored_embedding)
    return {
        "verified": similarity >= threshold,
        "similarity": round(similarity, 4),
        "threshold": threshold,
    }
