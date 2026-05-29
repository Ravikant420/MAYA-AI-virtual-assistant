FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libsndfile1 libportaudio2 ffmpeg \
    espeak espeak-ng libespeak-ng1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p data/faiss_index logs sandbox

ENV OLLAMA_HOST=http://host.docker.internal:11434
ENV API_PORT=8000
ENV LOG_LEVEL=INFO

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s CMD curl -f http://localhost:8000/system_status || exit 1
CMD ["python", "main.py"]
