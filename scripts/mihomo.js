import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

// 获取 base_dir 环境变量
const baseDir = process.env.base_dir; // 读取环境变量
// 设置最大重试次数
const maxRetries = 3;
// 设置重试间隔（单位：毫秒）
const retryInterval = 5000;
// 同时运行的转换任务数量，避免串行处理全部国家规则集
const concurrency = Math.max(1, Number.parseInt(process.env.CONVERT_CONCURRENCY || '4', 10));

// 如果没有设置 base_dir 环境变量，则终止程序并提示错误
if (!baseDir) {
  console.error('Error: base_dir 环境变量未设置');
  process.exit(1);
}

// 递归读取目录中的所有 *_IP.yaml 和 *_IP.json 文件
const findFiles = (dir) => {
  let results = [];
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat && stat.isDirectory()) {
      results = [...results, ...findFiles(fullPath)]; // 递归查找子目录
    } else if (file.endsWith('_IP.yaml') || file.endsWith('_IP.json')) {
      results.push(fullPath);
    }
  });

  return results;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 执行命令的封装，支持重试机制
const executeCommand = async (command, args) => {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        execFile(command, args, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt <= maxRetries) {
        console.warn(`命令失败，${retryInterval / 1000} 秒后重试 (${attempt}/${maxRetries})`);
        await delay(retryInterval);
      }
    }
  }

  throw lastError;
};

const getCommand = (srcFile) => {
  if (srcFile.endsWith('_IP.yaml')) {
    const targetFile = srcFile.replace('.yaml', '.mrs');
    return {
      command: 'mihomo',
      args: ['convert-ruleset', 'ipcidr', 'yaml', srcFile, targetFile],
      targetFile,
    };
  }

  const targetFile = srcFile.replace('.json', '.srs');
  return {
    command: 'sing-box',
    args: ['rule-set', 'compile', '--output', targetFile, srcFile],
    targetFile,
  };
};

const runWithConcurrency = async (items, workerCount, worker) => {
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(workerCount, items.length) }, () => runWorker()),
  );
};

// 处理文件
const processFiles = async () => {
  const files = findFiles(baseDir).sort();
  const failures = [];
  let completed = 0;

  console.log(`开始转换 ${files.length} 个文件，并发数: ${concurrency}`);

  await runWithConcurrency(files, concurrency, async (srcFile) => {
    const { command, args, targetFile } = getCommand(srcFile);

    try {
      await executeCommand(command, args);
    } catch (error) {
      failures.push(`${srcFile}: ${error.message}`);
    } finally {
      completed++;
      if (completed % 25 === 0 || completed === files.length) {
        console.log(`转换进度: ${completed}/${files.length}`);
      }
    }
  });

  if (failures.length > 0) {
    throw new Error(`转换失败:\n- ${failures.join('\n- ')}`);
  }

  console.log(`转换完成: ${files.length} 个文件`);
};

try {
  await processFiles();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
