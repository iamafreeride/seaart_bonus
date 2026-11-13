# syntax=docker/dockerfile:1
FROM python:3.12-alpine

# Do not write .pyc files and keep stdout/stderr unbuffered.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip uninstall -y pip setuptools wheel

COPY seaart_bonus.py ./

# Run as an unprivileged user; the container only needs outbound HTTPS.
RUN adduser -D -H -u 10001 seaart
USER 10001

# Credentials are supplied at runtime and are never copied into the image.
ENTRYPOINT ["python3", "/app/seaart_bonus.py"]
