FROM python:3.11-slim

# Install Lambda Web Adapter
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter

# uv バイナリをイメージからコピー（pip install より高速・軽量）
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# 仮想環境を作成して依存関係をインストール
RUN uv sync --frozen --no-dev --no-install-project

# Copy application code
COPY . .

# Environment variables for Lambda Web Adapter
ENV PORT=8000
ENV AWS_LWA_INVOKE_MODE=buffered

# ビルド時に作成済みの仮想環境Pythonでuvicornを起動
CMD ["/app/.venv/bin/python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
