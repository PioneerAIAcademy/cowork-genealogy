# sqsd shim (apps/server/proto/shim). Needs /var/run/docker.sock mounted so the
# read-timeout arm can kill and restart the worker container.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

# docker>=7.1 is the first release compatible with requests>=2.32's socket adapter.
RUN pip install "boto3>=1.35,<2" "docker>=7.1,<8" "requests>=2.32,<3"

COPY decide.py shim.py ./

CMD ["python", "shim.py"]
