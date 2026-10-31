# Nets analyser API for Google Cloud Run
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r server/requirements.txt
COPY nets nets
COPY server server
COPY models models
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1
CMD exec uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --timeout-keep-alive 75
