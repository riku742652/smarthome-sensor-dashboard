# uv 移行 実装計画

**タスク**: lambda ディレクトリの pip (requirements.txt) から uv (pyproject.toml + uv.lock) への依存関係管理の移行

**作成日**: 2026-04-04

**ステータス**: レビュー待ち

**関連リサーチ**: `docs/exec-plans/active/uv-migration-research.md`

---

## 目標と成功基準

<!-- APPROVED: -->

**目標**: `lambda/api` と `lambda/poller` の依存関係管理を pip + requirements.txt から uv + pyproject.toml + uv.lock に移行し、再現性の高いビルドとローカル開発体験を実現する。

**成功基準**:
- [ ] `lambda/api/pyproject.toml` が完成し、`uv sync` でローカル環境が構築できる
- [ ] `lambda/poller/pyproject.toml` が新規作成され、`uv sync` でローカル環境が構築できる
- [ ] `lambda/api/uv.lock` と `lambda/poller/uv.lock` がリポジトリに commit されている
- [ ] `lambda/api/Dockerfile` が `uv sync --frozen --no-dev` で依存インストールする
- [ ] `lambda/poller/Dockerfile` が `uv sync --frozen --no-dev` で依存インストールする
- [ ] `docker build` が両 Lambda で正常に完了する
- [ ] `pytest tests/` が両 Lambda で全テストパスする
- [ ] `lambda/**/requirements.txt` と `lambda/**/requirements-dev.txt` が削除されている
- [ ] `.github/workflows/terraform-ci.yml` のトリガーパスが `pyproject.toml` と `uv.lock` に更新されている
- [ ] `.gitignore` に uv 仮想環境のパスが追加されている

---

## アーキテクチャ上の変更

<!-- FEEDBACK: -->

### 削除ファイル
- `lambda/api/requirements.txt` - pyproject.toml の `dependencies` セクションに統合
- `lambda/api/requirements-dev.txt` - pyproject.toml の `[dependency-groups] dev` に統合
- `lambda/poller/requirements.txt` - pyproject.toml の `dependencies` セクションに統合
- `lambda/poller/requirements-dev.txt` - pyproject.toml の `[dependency-groups] dev` に統合

### 修正ファイル
- `lambda/api/pyproject.toml` - 既存ファイルを確認・必要に応じて修正（現状は正しい内容）
- `lambda/api/Dockerfile` - pip から uv sync へ変更
- `lambda/poller/Dockerfile` - pip から uv sync へ変更
- `.github/workflows/terraform-ci.yml` - トリガーパスの更新（9行目）
- `.gitignore` - Python 仮想環境パスの追加

### 新規ファイル
- `lambda/api/uv.lock` - api の依存関係ロックファイル（`uv sync` 実行により生成）
- `lambda/poller/pyproject.toml` - poller 用 pyproject.toml（新規作成）
- `lambda/poller/uv.lock` - poller の依存関係ロックファイル（`uv sync` 実行により生成）

### 依存ツール
- **追加**: `uv` （Dockerfile 内で `pip install uv` によりインストール）
  - Lambda ベースイメージ `public.ecr.aws/lambda/python:3.11` に uv はプリインストールされていないため

---

## pyproject.toml の内容

<!-- FEEDBACK: -->

### lambda/api/pyproject.toml（既存・確認済み）

現在のファイル内容はリサーチで定義した仕様と一致している。変更不要。

```toml
[project]
name = "lambda-api"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.104.0",
    "mangum>=0.17.0",
    "boto3>=1.34.0",
    "uvicorn>=0.24.0",
    "pydantic>=2.0.0",
]

[dependency-groups]
dev = [
    "pytest>=7.0",
    "pytest-mock>=3.0",
    "httpx>=0.24.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

**確認事項**:
- `requirements.txt` との対応: `fastapi>=0.104.0`, `mangum>=0.17.0`, `boto3>=1.34.0`, `uvicorn>=0.24.0`, `pydantic>=2.0.0` - 一致
- `requirements-dev.txt` との対応: `pytest>=7.0`, `pytest-mock>=3.0`, `httpx>=0.24.0` - 一致

### lambda/poller/pyproject.toml（新規作成）

```toml
[project]
name = "lambda-poller"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "boto3>=1.34.0",
    "requests>=2.31.0",
]

[dependency-groups]
dev = [
    "pytest>=7.0",
    "pytest-mock>=3.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

**確認事項**:
- `requirements.txt` との対応: `boto3>=1.34.0`, `requests>=2.31.0` - 一致
- `requirements-dev.txt` との対応: `pytest>=7.0`, `pytest-mock>=3.0` - 一致
- api との共通依存: `boto3` のバージョン制約を `>=1.34.0` で統一（api と同じ）

---

## Dockerfile の変更内容

<!-- FEEDBACK: -->

### lambda/api/Dockerfile（変更後）

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

# Install Lambda Web Adapter
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.7.1 /lambda-adapter /opt/extensions/lambda-adapter

# Install uv
RUN pip install uv

# Set working directory
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy dependency files and install (production only)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy application code
COPY . .

# Environment variables for Lambda Web Adapter
ENV PORT=8000
ENV AWS_LWA_INVOKE_MODE=response_stream

# Start FastAPI with uvicorn
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**変更点**:
- `RUN pip install uv` を追加（uv のインストール）
- `COPY requirements.txt .` → `COPY pyproject.toml uv.lock ./` に変更
- `RUN pip install --no-cache-dir -r requirements.txt` → `RUN uv sync --frozen --no-dev` に変更

**`--frozen` の意味**: lock ファイルが存在しない、または古い場合にエラーにする。CI/CD での意図しないバージョン更新を防止。

**`--no-dev` の意味**: `[dependency-groups] dev` の依存（pytest 等）を本番コンテナに含めない。

### lambda/poller/Dockerfile（変更後）

```dockerfile
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
```

**変更点**:
- `RUN pip install uv` を追加
- `COPY requirements.txt .` → `COPY pyproject.toml uv.lock ./` に変更
- `RUN pip install --no-cache-dir -r requirements.txt` → `RUN uv sync --frozen --no-dev` に変更

---

## GitHub Actions の変更内容

<!-- FEEDBACK: -->

### .github/workflows/terraform-ci.yml（変更箇所）

**変更対象**: `pull_request.paths`（7〜11行目）

**変更前**:
```yaml
on:
  pull_request:
    paths:
      - 'terraform/**/*.tf'
      - 'terraform/**/*.hcl'
      - 'lambda/**/*.py'
      - 'lambda/**/requirements.txt'
      - 'lambda/**/Dockerfile'
      - '.github/workflows/terraform-ci.yml'
```

**変更後**:
```yaml
on:
  pull_request:
    paths:
      - 'terraform/**/*.tf'
      - 'terraform/**/*.hcl'
      - 'lambda/**/*.py'
      - 'lambda/**/pyproject.toml'
      - 'lambda/**/uv.lock'
      - 'lambda/**/Dockerfile'
      - '.github/workflows/terraform-ci.yml'
```

**変更点**:
- `lambda/**/requirements.txt` を削除
- `lambda/**/pyproject.toml` を追加
- `lambda/**/uv.lock` を追加

**理由**: requirements.txt が削除されるため、pyproject.toml と uv.lock の変更時に CI が起動するよう更新する。

---

## 実装ステップ

<!-- FEEDBACK: -->

### ステップ 1: lambda/api の pyproject.toml 確認と uv.lock 生成

**目的**: 既存の `lambda/api/pyproject.toml` が正しい内容であることを確認し、`uv.lock` を生成してコミットする。

**アクション**:
1. `lambda/api/pyproject.toml` の内容を確認（現状は要件と一致）
2. `lambda/api/` で `uv sync` を実行して `uv.lock` を生成する
   ```bash
   cd lambda/api
   uv sync
   ```
3. 生成された `uv.lock` をステージングに追加（`.gitignore` には含まれていないことを確認）
4. テストが通ることを確認:
   ```bash
   # lambda/api ディレクトリで実行
   uv run pytest tests/
   ```

**完了基準**:
- [ ] `lambda/api/uv.lock` が生成されている
- [ ] `uv run pytest tests/` が全テストパスする
- [ ] `lambda/api/pyproject.toml` の内容が requirements.txt と一致している

**影響ファイル**:
- `lambda/api/pyproject.toml` (確認のみ、変更なし)
- `lambda/api/uv.lock` (新規生成)

---

### ステップ 2: lambda/poller の pyproject.toml 新規作成と uv.lock 生成

**目的**: `lambda/poller/pyproject.toml` を新規作成し、`uv.lock` を生成する。

**アクション**:
1. `lambda/poller/pyproject.toml` を以下の内容で作成する:
   ```toml
   [project]
   name = "lambda-poller"
   version = "0.1.0"
   requires-python = ">=3.11"
   dependencies = [
       "boto3>=1.34.0",
       "requests>=2.31.0",
   ]

   [dependency-groups]
   dev = [
       "pytest>=7.0",
       "pytest-mock>=3.0",
   ]

   [build-system]
   requires = ["hatchling"]
   build-backend = "hatchling.build"
   ```
2. `lambda/poller/` で `uv sync` を実行して `uv.lock` を生成する:
   ```bash
   cd lambda/poller
   uv sync
   ```
3. テストが通ることを確認:
   ```bash
   # lambda/poller ディレクトリで実行
   uv run pytest tests/
   ```

**完了基準**:
- [ ] `lambda/poller/pyproject.toml` が作成されている
- [ ] `lambda/poller/uv.lock` が生成されている
- [ ] `uv run pytest tests/` が全テストパスする
- [ ] `lambda/poller/requirements.txt` との依存が一致している

**影響ファイル**:
- `lambda/poller/pyproject.toml` (新規)
- `lambda/poller/uv.lock` (新規生成)

---

### ステップ 3: lambda/api/Dockerfile の更新

**目的**: `lambda/api/Dockerfile` を pip から uv を使用するよう更新する。

**アクション**:
1. `lambda/api/Dockerfile` を更新する:
   - `RUN pip install uv` を Lambda Web Adapter COPY の後に追加
   - `COPY requirements.txt .` を `COPY pyproject.toml uv.lock ./` に変更
   - `RUN pip install --no-cache-dir -r requirements.txt` を `RUN uv sync --frozen --no-dev` に変更
2. Docker ビルドのローカル動作確認:
   ```bash
   docker build --platform linux/amd64 -t lambda-api-test lambda/api/
   ```
3. コンテナ起動確認（任意）:
   ```bash
   # ローカルテスト用（ポート 9000 でテスト）
   docker run --rm -p 9000:8080 lambda-api-test
   ```

**完了基準**:
- [ ] `docker build` が成功する
- [ ] Dockerfile に `requirements.txt` の参照がなくなっている
- [ ] `uv sync --frozen --no-dev` が記述されている

**影響ファイル**:
- `lambda/api/Dockerfile` (修正)

---

### ステップ 4: lambda/poller/Dockerfile の更新

**目的**: `lambda/poller/Dockerfile` を pip から uv を使用するよう更新する。

**アクション**:
1. `lambda/poller/Dockerfile` を更新する:
   - `RUN pip install uv` を追加（WORKDIR の前）
   - `COPY requirements.txt .` を `COPY pyproject.toml uv.lock ./` に変更
   - `RUN pip install --no-cache-dir -r requirements.txt` を `RUN uv sync --frozen --no-dev` に変更
2. Docker ビルドのローカル動作確認:
   ```bash
   docker build --platform linux/amd64 -t lambda-poller-test lambda/poller/
   ```

**完了基準**:
- [ ] `docker build` が成功する
- [ ] Dockerfile に `requirements.txt` の参照がなくなっている
- [ ] `uv sync --frozen --no-dev` が記述されている

**影響ファイル**:
- `lambda/poller/Dockerfile` (修正)

---

### ステップ 5: requirements.txt と requirements-dev.txt の削除

**目的**: 不要になった requirements ファイルを削除する。

**アクション**:
1. 以下のファイルを削除する:
   - `lambda/api/requirements.txt`
   - `lambda/api/requirements-dev.txt`
   - `lambda/poller/requirements.txt`
   - `lambda/poller/requirements-dev.txt`
2. プロジェクト全体で `requirements.txt` への参照が残っていないことを確認:
   ```bash
   grep -r "requirements.txt" lambda/ --include="*.py" --include="*.yml" --include="*.yaml" --include="Dockerfile"
   ```

**完了基準**:
- [ ] 4つの requirements ファイルがすべて削除されている
- [ ] lambda/ ディレクトリ内で requirements.txt への残存参照がない

**影響ファイル**:
- `lambda/api/requirements.txt` (削除)
- `lambda/api/requirements-dev.txt` (削除)
- `lambda/poller/requirements.txt` (削除)
- `lambda/poller/requirements-dev.txt` (削除)

---

### ステップ 6: .gitignore の更新

**目的**: uv が生成する仮想環境ディレクトリを `.gitignore` に追加する。

**アクション**:
1. `.gitignore` の Lambda セクションに以下を追加する:
   ```
   # uv
   lambda/**/.venv/
   ```
2. 現在の `.gitignore` 末尾の Lambda セクションは以下:
   ```
   # Lambda
   lambda/**/__pycache__/
   lambda/**/.pytest_cache/
   lambda/**/*.pyc
   ```
   これに `.venv/` の行を追加する。

**完了基準**:
- [ ] `.gitignore` に `lambda/**/.venv/` が追加されている
- [ ] `uv sync` 後に `.venv/` が git に追加されないことを確認

**影響ファイル**:
- `.gitignore` (修正)

---

### ステップ 7: GitHub Actions トリガーパスの更新

**目的**: `.github/workflows/terraform-ci.yml` の PR トリガーパスを requirements.txt から pyproject.toml / uv.lock に変更する。

**アクション**:
1. `.github/workflows/terraform-ci.yml` の `pull_request.paths`（9行目）を修正する:
   - `'lambda/**/requirements.txt'` を削除
   - `'lambda/**/pyproject.toml'` を追加
   - `'lambda/**/uv.lock'` を追加

**完了基準**:
- [ ] `lambda/**/requirements.txt` がトリガーパスから削除されている
- [ ] `lambda/**/pyproject.toml` がトリガーパスに追加されている
- [ ] `lambda/**/uv.lock` がトリガーパスに追加されている

**影響ファイル**:
- `.github/workflows/terraform-ci.yml` (修正)

---

## テスト戦略

<!-- FEEDBACK: -->

### ローカル検証手順

#### 1. uv インストール確認
```bash
uv --version
# 期待: uv X.X.X が表示される
```

uv がインストールされていない場合:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

#### 2. lambda/api のローカル動作確認
```bash
cd lambda/api

# 仮想環境の作成と依存インストール（開発依存含む）
uv sync

# テスト実行
uv run pytest tests/ -v

# 期待: 23テストケースがすべてパス
```

#### 3. lambda/poller のローカル動作確認
```bash
cd lambda/poller

# 仮想環境の作成と依存インストール（開発依存含む）
uv sync

# テスト実行
uv run pytest tests/ -v

# 期待: 26テストケースがすべてパス
```

#### 4. Docker ビルド確認
```bash
# api
docker build --platform linux/amd64 -t lambda-api-test lambda/api/
# 期待: Successfully built XXXXXXXXXX

# poller
docker build --platform linux/amd64 -t lambda-poller-test lambda/poller/
# 期待: Successfully built XXXXXXXXXX
```

#### 5. lock ファイル再現性確認
```bash
# 既存の .venv を削除して再同期
cd lambda/api
rm -rf .venv
uv sync --frozen  # --frozen でロックファイルと一致することを確認

cd lambda/poller
rm -rf .venv
uv sync --frozen
```

### 確認チェックリスト
- [ ] `uv sync` が lambda/api で成功する
- [ ] `uv sync` が lambda/poller で成功する
- [ ] `uv run pytest tests/` が lambda/api で全テストパスする
- [ ] `uv run pytest tests/` が lambda/poller で全テストパスする
- [ ] `docker build` が lambda/api で成功する
- [ ] `docker build` が lambda/poller で成功する
- [ ] `.venv/` が git status に表示されない（.gitignore 適用確認）
- [ ] requirements.txt ファイルが git status に削除済みとして表示される

---

## 既知のリスクと対策

<!-- FEEDBACK: -->

### リスク 1: Lambda ベースイメージへの uv インストール

**問題**: `public.ecr.aws/lambda/python:3.11` に uv がプリインストールされていない。

**影響**: Medium - Docker ビルド時間がわずかに増加（初回のみ、レイヤーキャッシュで軽減）

**対策**: `RUN pip install uv` を Dockerfile 冒頭（依存インストール前）に追加。最初のビルド後はレイヤーキャッシュで高速化される。

**代替案**: astral.sh から uv バイナリを直接ダウンロードする方法もあるが、pip install のほうがシンプルで Lambda 環境と親和性が高い。

---

### リスク 2: uv.lock の管理コスト

**問題**: uv.lock をリポジトリに commit する必要があり、依存更新のたびに PR に lock ファイル変更が含まれる。

**影響**: Low - PR レビュー範囲が若干増加するが、再現性の恩恵のほうが大きい

**対策**:
- `--frozen` オプションを Docker ビルドで使用し、lock ファイルと pyproject.toml の不整合を CI で検出
- PR レビュー時に lock ファイルの変更が意図したものかを確認

---

### リスク 3: hatchling ビルドバックエンドの必要性

**問題**: `[build-system]` セクションで `hatchling` をビルドバックエンドとして指定しているが、Lambda では `pip install -e .` のようなパッケージビルドを行わない。

**影響**: Low - uv sync は pyproject.toml を参照するため hatchling が不要な可能性があるが、[build-system] セクションは uv の動作に影響しない。

**対策**: 現状の `hatchling` 指定を維持。将来的に不要と判断された場合は削除を検討。

---

### リスク 4: terraform-ci.yml の requirements.txt 参照削除

**問題**: CI のトリガーパスから `lambda/**/requirements.txt` を削除すると、移行前後の PR（混在状態）で CI が期待通りに動作しない可能性がある。

**影響**: Low - 移行は1つの PR で完結するため、混在状態は発生しない

**対策**: ステップ 7 を最後に実施し、すべての requirements.txt が削除された後に CI を更新する。

---

## 代替アプローチ（採用しなかった案）

<!-- APPROVED: -->

### アプローチ A: uv ワークスペース構成
`lambda/` 直下にルート pyproject.toml を配置し、api と poller をサブパッケージとして管理。

**不採用理由**:
- Lambda コンテナビルド時にワークスペース全体をコピーする必要があり、Docker イメージサイズが増加
- Dockerfile が複雑化（`--directory` オプション等）
- 現状 `lambda/api/pyproject.toml` が既に個別配置されているため一貫性が崩れる

### アプローチ B: uv pip install（pip 互換モード）
`RUN uv pip install .` で pip コマンドラインを踏襲。

**不採用理由**:
- `uv.lock` の恩恵（再現可能ビルド）を受けられない
- `--frozen` オプションが使えないため、CI/CD での意図しないバージョン更新を防止できない

### アプローチ C: 変更なし（pip 継続）
現状維持。

**不採用理由**:
- pip は依存解決が低速でロックファイルによる再現性保証がない
- uv のほうが開発体験・ビルド速度・再現性で優れている

---

## 実装後タスク

<!-- FEEDBACK: -->

- [ ] ARCHITECTURE.md の「開発ツール」セクションに uv を追加（Python 依存管理ツール）
- [ ] 計画ドキュメントを `docs/exec-plans/completed/` に移動
- [ ] ローカル開発手順のドキュメント更新（README があれば）

---

## 実装順序サマリー

| ステップ | 内容 | 影響ファイル数 | 依存 |
|---------|------|--------------|------|
| 1 | lambda/api の uv.lock 生成 | 1 (新規) | なし |
| 2 | lambda/poller の pyproject.toml 作成 + uv.lock 生成 | 2 (新規) | なし |
| 3 | lambda/api/Dockerfile 更新 | 1 (修正) | ステップ 1 |
| 4 | lambda/poller/Dockerfile 更新 | 1 (修正) | ステップ 2 |
| 5 | requirements.txt / requirements-dev.txt 削除 | 4 (削除) | ステップ 3, 4 |
| 6 | .gitignore 更新 | 1 (修正) | なし |
| 7 | terraform-ci.yml トリガーパス更新 | 1 (修正) | ステップ 5 |

**合計**: 新規 3, 修正 3, 削除 4 = 10 ファイル操作

---

*このドキュメントは人間によるレビューを待っています。各セクションに `<!-- APPROVED: -->` または `<!-- FEEDBACK: 指摘内容 -->` を追加してレビューしてください。*
