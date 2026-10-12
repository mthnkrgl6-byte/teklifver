FROM python:3.12-slim
WORKDIR /app
COPY index.html server.py ./
ENV PYTHONUNBUFFERED=1
EXPOSE 8768
CMD ["sh", "-c", "python server.py --host 0.0.0.0 --port ${PORT:-8768} --no-browser"]
