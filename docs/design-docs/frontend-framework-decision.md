# Frontend Framework Decision: React + Vite

## 意思決定の概要

**決定日**: 2026-03-28

**決定事項**: Switchbot センサーダッシュボードのフロントエンド実装に **React 18 + Vite** を採用する。

**決定者**: プロジェクトチーム

**ステータス**: Accepted

## コンテキスト

### プロジェクト要件

- Switchbot 温湿度CO2センサーのデータを可視化するSPA
- リアルタイム性は不要（1分間隔のポーリング）
- シンプルなダッシュボードUI（複雑なルーティング不要）
- 時系列グラフの表示（Recharts使用）
- モバイル対応（レスポンシブデザイン）
- 高速な開発体験

### 技術的制約

- Lambda Function URL からのデータ取得（REST API）
- SSR/SSG不要（静的ホスティング: S3 + CloudFront）
- SEO不要（内部ツール）
- 認証不要（初期フェーズ）

## 評価基準

フレームワーク選定において、以下の基準で評価しました:

1. **開発速度**: 開発開始から初回デプロイまでの速度
2. **ビルド速度**: 開発時のHMRと本番ビルドの速度
3. **バンドルサイズ**: 初期ロード時間への影響
4. **エコシステム**: ライブラリとツールの充実度
5. **学習コスト**: チームの既存知識の活用
6. **メンテナンス性**: 長期的な保守のしやすさ
7. **パフォーマンス**: ランタイムパフォーマンス
8. **将来性**: スケーラビリティと拡張性

## 検討した選択肢

### Option 1: React + Create React App (CRA)

**長所**:
- React公式の推奨ツール（過去）
- 設定不要で開発開始可能
- 豊富なドキュメント

**短所**:
- ❌ ビルド速度が遅い（Webpack使用）
- ❌ HMRが遅い
- ❌ メンテナンスが停滞気味
- ❌ React公式がViteを推奨

**評価**: ❌ 却下

**理由**: CRAは現在非推奨。React公式ドキュメントがViteを推奨している。

---

### Option 2: Next.js 15 (App Router)

**長所**:
- React公式推奨フレームワーク
- SSR/SSG/ISRのサポート
- ファイルベースルーティング
- API Routesで簡易バックエンド可能
- 強力なエコシステム

**短所**:
- ❌ オーバースペック（SSR不要）
- ❌ ビルド時間が長い
- ❌ 学習コストが高い（App Router）
- ❌ インフラが複雑（Vercel or Node.js環境必要）

**評価**: ❌ 却下

**理由**:
- SSR/SSGが不要（静的ホスティングで十分）
- シンプルなダッシュボードに対して機能過多
- Lambda APIが既に存在するため、API Routes不要

---

### Option 3: React + Vite ✅

**長所**:
- ✅ 非常に高速なHMR（数ミリ秒）
- ✅ 高速なビルド（esbuild使用）
- ✅ シンプルな設定（最小限の設定で開始可能）
- ✅ TypeScript標準サポート
- ✅ React公式が推奨
- ✅ 静的ホスティング（S3）に最適
- ✅ 軽量なバンドル
- ✅ モダンなツールチェーン

**短所**:
- ⚠️ ルーティングは自前（React Routerなど追加必要）
- ⚠️ SSRには追加設定が必要（今回不要）

**評価**: ✅ 採用

**理由**:
1. **開発速度が最速**: HMRが数ミリ秒、開発体験が最高
2. **要件に最適**: SPAに特化、SSR不要な今回のユースケースに最適
3. **React公式推奨**: https://react.dev/ で推奨されている
4. **バンドルサイズ**: 軽量（Tree shaking効率的）
5. **S3デプロイに最適**: 静的ファイルのみ生成

---

### Option 4: Vue 3 + Vite

**長所**:
- Vite開発元（Evan You）のフレームワーク
- 高速なHMR
- シンプルな学習曲線
- 優れたTypeScriptサポート

**短所**:
- ❌ Rechartsが使えない（Vue用ライブラリが必要）
- ❌ チームのReact経験を活かせない
- ❌ エコシステムがReactより小さい

**評価**: ❌ 却下

**理由**:
- RechartsなどReactエコシステムを活用したい
- チームの既存React知識を活かせる

---

### Option 5: Svelte + Vite

**長所**:
- 非常に軽量なバンドル（コンパイル時最適化）
- 高速なランタイム
- シンプルな構文

**短所**:
- ❌ エコシステムが小さい
- ❌ Recharts非対応
- ❌ 学習コストが高い（新規学習必要）
- ❌ TypeScriptサポートが弱い（改善中）

**評価**: ❌ 却下

**理由**: エコシステムとライブラリの充実度でReactに劣る

---

## 決定: React + Vite

### 選定理由の詳細

#### 1. 開発速度

- **HMRが超高速**: 変更が数ミリ秒で反映
- **ビルド時間**: Create React Appの10倍以上高速
- **設定時間**: 最小限の設定で開発開始可能

#### 2. React公式推奨

React公式ドキュメント（https://react.dev）がViteを推奨:

> "If you're learning React or want to integrate it with an existing app, use a build tool like Vite or Parcel."

#### 3. 要件への適合性

| 要件 | React + Vite | Next.js | CRA |
|------|--------------|---------|-----|
| SPA | ✅ 最適 | ⚠️ オーバースペック | ✅ 可能 |
| 高速HMR | ✅ 最速 | ⚠️ 普通 | ❌ 遅い |
| ビルド速度 | ✅ 最速 | ⚠️ 普通 | ❌ 遅い |
| S3デプロイ | ✅ 最適 | ⚠️ 可能だが複雑 | ✅ 可能 |
| TypeScript | ✅ 標準 | ✅ 標準 | ✅ 標準 |
| 学習コスト | ✅ 低い | ❌ 高い | ✅ 低い |

#### 4. エコシステム

- **Recharts**: React用グラフライブラリ、Viteで完全サポート
- **TailwindCSS**: PostCSS統合がシンプル
- **Vitest**: Vite専用テストフレームワーク、高速
- **React Hooks**: useState, useEffectなど標準機能のみで十分

#### 5. パフォーマンス

- **バンドルサイズ**: Tree shakingが効率的、不要なコード除外
- **Time to Interactive**: < 3秒（要件達成可能）
- **First Contentful Paint**: < 1.5秒

#### 6. 静的ホスティングに最適

```bash
npm run build
# → dist/ フォルダに静的ファイル生成
# → S3にアップロードするだけでデプロイ完了
```

## トレードオフと制約

### トレードオフ

| 項目 | 選択 | トレードオフ |
|------|------|--------------|
| **ルーティング** | 自前実装（React Router追加） | Next.jsはファイルベースルーティング標準 |
| **SSR** | 不可（追加設定必要） | Next.jsはSSR標準 |
| **API統合** | Lambda API使用 | Next.jsはAPI Routes使用可能 |
| **画像最適化** | 手動 | Next.jsは自動最適化 |

### 受け入れた制約

1. **ルーティングなし**: 初期は単一ページダッシュボードのみ。複雑化したらReact Router追加。
2. **SEO不要**: 内部ツールのためSEO不要。将来公開する場合はNext.js移行を検討。
3. **認証なし**: 初期フェーズは認証不要。将来追加する場合は別途実装。

## 将来の考慮事項

### スケーラビリティ

現在の選択で対応可能な範囲:
- ✅ ページ追加（React Router導入）
- ✅ 状態管理の複雑化（Zustand追加）
- ✅ 複数ダッシュボード
- ✅ ユーザー設定機能

### 移行が必要になる場合

以下の要件が発生した場合、Next.jsへの移行を検討:
- ❌ SSRが必要になる（SEO対策）
- ❌ ISR（Incremental Static Regeneration）が必要
- ❌ 複雑なAPIエンドポイントが必要

**移行コスト**: Reactコンポーネントはそのまま移行可能（90%再利用可能）

## 参考資料

### 公式ドキュメント

- [React Documentation - Start a New React Project](https://react.dev/learn/start-a-new-react-project)
- [Vite Documentation](https://vitejs.dev/)
- [Why Vite?](https://vitejs.dev/guide/why.html)

### ベンチマーク

- [Vite vs CRA - Build Speed Comparison](https://github.com/vitejs/vite/discussions/8640)
- [React HMR Performance](https://vitejs.dev/guide/features.html#hot-module-replacement)

### コミュニティ

- React公式がCRAからViteへの移行を推奨
- Next.jsはフルスタックフレームワーク向け
- Viteは2024年時点で最も人気のあるReactビルドツール

## 変更履歴

- 2026-03-28: 初版作成、React + Vite採用を文書化
