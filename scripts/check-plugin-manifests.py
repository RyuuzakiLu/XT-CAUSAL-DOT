"""================================================================
Dot插件描述校验 · 总导游图

▍这是什么
校验协议Schema、设计夹具及关键拒绝用例；依赖Python/jsonschema，给插件协议维护者使用。

▍结构
读取协议和示例；验证正常描述；验证错误描述必须被拒；输出机器可读结果。

▍修改铁律
1. 【不】加载插件或联网；格式检查不证明运行时权限和卸载已经实现。
2. 【不】检查示例入口文件存在；示例只是清单夹具，不是可安装包。

▍更新记录
2026-10-23 · 建立协议结构正反例检查。
================================================================"""
from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator


# 同目录定位让交付件搬到别的机器仍能检查，避免依赖开发者工作目录。
def check_manifests():
    root = Path(__file__).resolve().parents[1]
    schema = json.loads((root / "contracts/dot-plugin-v1.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    manifests = [json.loads(path.read_text(encoding="utf-8")) for path in sorted((root / "examples/plugins").glob("*.dot.plugin.json"))]
    if not manifests:
        raise AssertionError("缺少正常清单夹具")
    cases = [("schema-valid", True)]
    for manifest in manifests:
        validator.validate(manifest)
        cases.append(("accept:" + manifest["id"], True))
    baseline = next(item for item in manifests if item["id"] == "xtcausal.crm")
    mutations = [
        ("wrong-protocol", lambda value: value.update(protocolVersion="2.0")),
        ("unknown-field", lambda value: value.update(namespace="another-user")),
        ("missing-permissions", lambda value: value.pop("permissions")),
        ("absolute-entry", lambda value: value.update(entry="/host/index.mjs")),
        ("parent-entry", lambda value: value.update(entry="../index.mjs")),
        ("namespace-permission", lambda value: value.update(permissions=["memory:cross"])),
        ("duplicate-permission", lambda value: value.update(permissions=["memory:recall", "memory:recall"])),
        ("unsafe-write-retry", lambda value: value["tools"][1].update(recovery="retry-safe")),
        ("unsafe-write-approval", lambda value: value["tools"][1].update(approval="policy")),
        ("oversized-timeout", lambda value: value["tools"][0].update(timeoutSeconds=601)),
        ("invalid-runtime", lambda value: value.update(runtime="unrestricted")),
        ("destructive-uninstall", lambda value: value["data"].update(uninstall="delete")),
        ("uncontrolled-code-upgrade", lambda value: value["lifecycle"].update(codeUpgrade="always-hot")),
    ]
    for name, mutate in mutations:
        sample = deepcopy(baseline)
        mutate(sample)
        if validator.is_valid(sample):
            raise AssertionError("错误清单未被拒绝: " + name)
        cases.append(("reject:" + name, True))
    print(json.dumps({"scope": "manifest-structure-only", "passed": len(cases), "failed": 0, "cases": [{"name": name, "passed": passed} for name, passed in cases]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    check_manifests()
