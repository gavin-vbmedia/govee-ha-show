# The Supervisor passes BUILD_ARCH (amd64 or aarch64).
ARG BUILD_ARCH=amd64
FROM ghcr.io/home-assistant/${BUILD_ARCH}-base-python:3.13-alpine3.22

COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY app/ /app/
WORKDIR /app

CMD ["python3", "-m", "goveeshow"]
