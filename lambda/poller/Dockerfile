FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

# 依存パッケージをインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコードをコピー
COPY . .

# Lambda イベントハンドラー（HTTP サーバー不要のため CMD で直接指定）
CMD ["lambda_function.lambda_handler"]
