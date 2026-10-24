FROM python:3.12-slim
RUN useradd -m relais
USER relais
WORKDIR /home/relais
COPY --chown=relais app.py .
EXPOSE 7860
CMD ["python", "app.py"]
