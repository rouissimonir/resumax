# 1. Use 'bullseye' (Debian 11) for stability
FROM python:3.10-bullseye

# 2. Install System Dependencies
# ADDED: tesseract-ocr (Required for pytesseract)
#
# Debian 11 (bullseye) is EOL, and this base image's bullseye-security source
# now 404s, which made the whole `apt-get update` fail ("unable to fetch some
# archives", exit code 100) on every build — Render then kept serving the
# last image that had built successfully, well behind what was on master.
# The main and bullseye-updates sources (deb.debian.org) still work fine;
# only the dead security line needs to go. Verified locally against
# python:3.10-bullseye before relying on it again.
RUN sed -i '/debian-security/d' /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y \
    poppler-utils \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# 3. Set work directory
WORKDIR /app

# 4. Install Python Dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip

# Install PaddlePaddle CPU (Keep this only if you still use Paddle in some parts)
RUN pip install --no-cache-dir paddlepaddle==2.6.0 -f https://www.paddlepaddle.org.cn/whl/linux/mkl/avx/stable.html

# Install the rest
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copy App Code
COPY . .

# 6. Expose Port
EXPOSE 8000

# 7. Run Server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
