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
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: {}, body: content.trimStart() };
  }

  const frontmatterText = match[1];
  const body = content.slice(match[0].length).trimStart();
  const frontmatter = {};

  const lines = frontmatterText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s/.test(line)) continue;

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!keyMatch) continue;

    const [, key, rawValue] = keyMatch;
    if (key !== 'name' && key !== 'description') continue;

    const trimmedValue = rawValue.trim();

    if (trimmedValue === '|' || trimmedValue === '>') {
      const blockLines = [];
      i += 1;

      while (i < lines.length) {
        const blockLine = lines[i];

        if (blockLine === '') {
          blockLines.push('');
          i += 1;
          continue;
        }

        const indentMatch = blockLine.match(/^(\s+)(.*)$/);
        if (!indentMatch) break;

        blockLines.push(indentMatch[2]);
        i += 1;
      }

      i -= 1;
      frontmatter[key] =
        trimmedValue === '>'
          ? blockLines.join('\n').replace(/\n+/g, ' ').trim()
          : blockLines.join('\n').replace(/\s+$/, '');
      continue;
    }

    frontmatter[key] = trimmedValue
      .replace(/^"([\s\S]*)"$/u, '$1')
      .replace(/^'([\s\S]*)'$/u, '$1');
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
    'model: Claude Sonnet 4.6',
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

  const generatedNames = new Set();
  const expectedFiles = new Set();

  for (const fileName of sourceFiles) {
    const srcPath = path.join(claudeAgentsDir, fileName);
    const srcContent = await fs.readFile(srcPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(srcContent);

    const name = frontmatter.name || path.basename(fileName, '.md');

    if (generatedNames.has(name)) {
      throw new Error(`Duplicate agent name detected: ${name}`);
    }
    generatedNames.add(name);

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
    expectedFiles.add(path.basename(dstPath));
    await fs.writeFile(dstPath, `${copilotFrontmatter}\n${generatedBody}`, 'utf8');
  }

  // 既に source 側から消えた生成ファイルはクリーンアップする。
  const copilotEntries = await fs.readdir(copilotAgentsDir, { withFileTypes: true });
  for (const entry of copilotEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.agent.md')) continue;
    if (expectedFiles.has(entry.name)) continue;

    const targetPath = path.join(copilotAgentsDir, entry.name);
    const fileContent = await fs.readFile(targetPath, 'utf8');
    if (fileContent.includes('このファイルは scripts/sync-agents.mjs により')) {
      await fs.unlink(targetPath);
    }
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