import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const claudeAgentsDir = path.join(rootDir, '.claude', 'agents');
const copilotAgentsDir = path.join(rootDir, '.github', 'agents');

const copilotSettingsByAgent = {
  'harness-researcher': {
    tools: ['read', 'search', 'execute'],
    argumentHint:
      '何を調査するかを具体的に指定する（対象機能、制約、欲しい成果物）',
  },
  'harness-planner': {
    tools: ['read', 'edit', 'search'],
    argumentHint:
      '対象タスク名と、元にする research ドキュメントを指定する',
  },
  'harness-executor': {
    tools: ['read', 'edit', 'search', 'execute', 'todo'],
    argumentHint: '実装対象の plan ファイルと、必要なら PR 番号を指定する',
  },
  'harness-doc-updater': {
    tools: ['read', 'edit', 'search'],
    argumentHint: '完了したタスク名と、更新対象ドキュメント範囲を指定する',
  },
};

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: content.trimStart() };
  }

  const frontmatterText = match[1];
  const body = content.slice(match[0].length).trimStart();
  const frontmatter = {};

  for (const line of frontmatterText.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

function yamlQuote(text) {
  return `"${String(text).replace(/"/g, '\\"')}"`;
}

function formatCopilotFrontmatter({ name, description, tools, argumentHint }) {
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${yamlQuote(description)}`,
    `tools: [${tools.join(', ')}]`,
    'model: GPT-5 (copilot)',
  ];

  if (argumentHint) {
    lines.push(`argument-hint: ${yamlQuote(argumentHint)}`);
  }

  lines.push('---');
  return `${lines.join('\n')}\n`;
}

async function main() {
  await fs.mkdir(copilotAgentsDir, { recursive: true });

  const entries = await fs.readdir(claudeAgentsDir, { withFileTypes: true });
  const sourceFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of sourceFiles) {
    const srcPath = path.join(claudeAgentsDir, fileName);
    const srcContent = await fs.readFile(srcPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(srcContent);

    const name = frontmatter.name || path.basename(fileName, '.md');
    const description =
      frontmatter.description ||
      `${name} の Copilot 向けサブエージェント定義（.claude/agents と同期）`;
    const settings = copilotSettingsByAgent[name] || {
      tools: ['read', 'search'],
      argumentHint: '',
    };

    const copilotFrontmatter = formatCopilotFrontmatter({
      name,
      description,
      tools: settings.tools,
      argumentHint: settings.argumentHint,
    });

    const generatedBody = [
      '# Instruction',
      `<!-- このファイルは scripts/sync-agents.mjs により ${path
        .join('.claude', 'agents', fileName)
        .replace(/\\/g, '/')} から自動生成されます -->`,
      '',
      body.trim(),
      '',
    ].join('\n');

    const dstPath = path.join(copilotAgentsDir, `${name}.agent.md`);
    await fs.writeFile(dstPath, `${copilotFrontmatter}\n${generatedBody}`, 'utf8');
  }

  console.log(
    `Synced ${sourceFiles.length} agent files from ${path.relative(
      rootDir,
      claudeAgentsDir,
    )} to ${path.relative(rootDir, copilotAgentsDir)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});