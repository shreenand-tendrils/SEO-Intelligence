FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 CRAWLER_HOST=0.0.0.0 CRAWLER_PORT=5002 HOME=/home/app
ARG INSTALL_PLAYWRIGHT=false
RUN useradd -m -u 10001 app
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt \
 && if [ "$INSTALL_PLAYWRIGHT" = "true" ]; then pip install playwright && PLAYWRIGHT_BROWSERS_PATH=/ms-playwright playwright install --with-deps chromium && chmod -R a+rx /ms-playwright; fi
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --chown=app:app . .
USER app
EXPOSE 5002
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD python -c "import os,urllib.request;r=urllib.request.Request('http://127.0.0.1:' + os.environ.get('PORT',os.environ.get('CRAWLER_PORT','5002')) + '/internal/health',headers={'X-Internal-Token':os.environ.get('INTERNAL_API_TOKEN','')});urllib.request.urlopen(r,timeout=4)"
CMD ["python", "app.py"]
