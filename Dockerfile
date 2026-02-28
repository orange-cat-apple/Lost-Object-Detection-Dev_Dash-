# Use a lightweight Python base
FROM python:3.10-slim

# Install wget to download your model
RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*

# Set up a new user (Required by Hugging Face Spaces security)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

# Copy your requirements and install them
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download your golden model from the GitHub Release
RUN wget -O model.pt "https://github.com/orange-cat-apple/Lost-Object-Detection-Dev_Dash-/releases/download/V1.0/Doubleclass.pt"

# Copy the rest of your server code
COPY --chown=user . .

# Hugging Face strictly uses port 7860
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
