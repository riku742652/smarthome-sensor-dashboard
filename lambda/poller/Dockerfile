FROM public.ecr.aws/lambda/python:3.11

# Install uv
RUN pip install uv

WORKDIR ${LAMBDA_TASK_ROOT}

# Copy dependency files and install (production only)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy application code
COPY . .

# Lambda event handler
CMD ["lambda_function.lambda_handler"]
