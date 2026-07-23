import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const config = yaml.load(fs.readFileSync("./config/config.yaml", "utf8"));
const errors = [];
const summary = [];

function validateRuleSet(directory, name) {
  const base = path.join(directory, name);
  const asnPath = path.join(base, `${name}_ASN.list`);
  const cidrPath = path.join(base, `${name}_IP.list`);
  const jsonPath = path.join(base, `${name}_IP.json`);

  for (const file of [asnPath, cidrPath, jsonPath]) {
    if (!fs.existsSync(file)) {
      errors.push(`${file}: 文件不存在`);
      return;
    }
  }

  const asns = fs
    .readFileSync(asnPath, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("IP-ASN,"))
    .map((line) => line.split(",")[1]);
  const cidrs = fs
    .readFileSync(cidrPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (asns.length === 0) errors.push(`${asnPath}: ASN 列表为空`);
  if (new Set(asns).size !== asns.length) errors.push(`${asnPath}: 存在重复 ASN`);
  if (new Set(cidrs).size !== cidrs.length) errors.push(`${cidrPath}: 存在重复 CIDR`);
  if (asns.some((asn) => !/^\d+$/.test(asn))) errors.push(`${asnPath}: ASN 格式错误`);

  try {
    const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const jsonCidrs = json?.rules?.[0]?.ip_cidr;
    if (!Array.isArray(jsonCidrs) || jsonCidrs.length !== cidrs.length) {
      errors.push(`${jsonPath}: JSON 与 list 的 CIDR 数量不一致`);
    }
  } catch (error) {
    errors.push(`${jsonPath}: JSON 无效 (${error.message})`);
  }

  summary.push({ ruleSet: `${directory}/${name}`, asns: asns.length, cidrs: cidrs.length });
}

for (const name of config.namelist) validateRuleSet("data", name);
for (const name of config.country) validateRuleSet("country", name);

if (errors.length > 0) {
  console.error(`校验失败:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

const totalAsns = summary.reduce((sum, item) => sum + item.asns, 0);
const totalCidrs = summary.reduce((sum, item) => sum + item.cidrs, 0);
console.log(`校验通过: ${summary.length} 个规则集，${totalAsns} 个 ASN，${totalCidrs} 个 CIDR`);
