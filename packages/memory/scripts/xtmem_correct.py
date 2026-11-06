# -*- coding: utf-8 -*-
"""DOT 记忆 · 纠正桥（`correct` 专用）

================================================================
导游图（改代码前必读）

▍这是什么
XTMEM 引擎**没有 update 接口**（公开源码核实：`VectorStore` 只提供
`store_chunk` / `mark_superseded` / `update_chunk_track`，CLI 也没有改名或改写正文的命令）。
所以"纠正"只能由引擎自己支持的两个真实动作组合出来：

    ① `ContextBuilder.store()` 落一条**新**记忆（正确的事实）
    ② `VectorStore.mark_superseded()` 把旧条目退役，并把 `superseded_by`
       写成指向新条目的**真指针**（引擎的 D1-1 契约只认真指针形状 `mem-xxxxxxxx`）

本脚本只做这两步，不发明新语义、不直接 UPDATE 正文。

▍为什么单开一个 Python 脚本，而不是让 Node 直连 SQLite
引擎的退役逻辑里有三件必须一起做的事（清 FTS5 行、清 embedding_cache、bump updated_at），
手写 SQL 会漏其中一件，然后就是"退役了还能搜到"的幽灵召回。调用引擎自己的方法才安全。

▍输入/输出
stdin：一个 JSON 对象 `{dbPath, engineRoot, workspaceDir, actor, namespace,
       oldId, text, importance, tags, reason, hostOrigin}`
stdout：一个 JSON 对象；`ok=false` 时 `error` 说明原因，且**不谎报已纠正**。

▍修改铁律
1. 【不】把退役放在写入之前：新条目没落地就把旧的退役，等于用户永久丢掉这条记忆。
2. 【不】在 mark_superseded 返回 False 时仍报 ok=true；那表示旧条目没被退役，
   下一轮仍会被召回，等于"纠正没生效"。
3. 【不】吞掉异常输出空 JSON：调用方会把空当成"引擎坏了"而不是"已成功"。
4. 【不】读任何用户私有路径；所有路径都从 stdin 传入（由适配器按配置给定）。
"""

import json
import os
import sys
import traceback


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:  # 输入坏掉也要回一个可判的 JSON
        print(json.dumps({"ok": False, "error": "bad input json: %s" % exc}, ensure_ascii=False))
        return 0

    engine_root = str(payload.get("engineRoot") or "")
    db_path = str(payload.get("dbPath") or "")
    workspace = str(payload.get("workspaceDir") or "")
    actor = str(payload.get("actor") or "")
    namespace = str(payload.get("namespace") or "")
    old_id = str(payload.get("oldId") or "")
    text = str(payload.get("text") or "")
    reason = str(payload.get("reason") or "corrected by user")

    if not engine_root or not os.path.isdir(engine_root):
        print(json.dumps({"ok": False, "error": "engineRoot 不存在: %r" % engine_root}, ensure_ascii=False))
        return 0
    if not db_path:
        print(json.dumps({"ok": False, "error": "dbPath 为空（拒绝在未知库上纠正）"}, ensure_ascii=False))
        return 0
    if not old_id or not text.strip():
        print(json.dumps({"ok": False, "error": "oldId 与 text 都必须非空"}, ensure_ascii=False))
        return 0

    # 身份只从环境变量/入参给定；模型与前端不可覆盖（与 CLI 同口径）。
    os.environ["XTMEM_ACTOR"] = actor
    os.environ["XTMEM_DB_PATH"] = db_path
    if engine_root not in sys.path:
        sys.path.insert(0, os.path.dirname(os.path.abspath(engine_root)))

    try:
        from memory.context_builder import ContextBuilder
        from memory.vector_store import VectorStore
    except Exception as exc:
        print(json.dumps({"ok": False, "error": "无法导入引擎: %s" % exc}, ensure_ascii=False))
        return 0

    builder = None
    try:
        builder = ContextBuilder(
            workspace_dir=workspace,
            context_window=128_000,
            config={
                "db_path": db_path,
                "prefetch_only": True,
                "compression_enabled": False,
                "rest_api": False,  # 不抢观测端口：本脚本是一次性进程
            },
        )
        metadata = {
            "namespace": namespace,
            "importance": float(payload.get("importance") or 0.6),
            "tags": list(payload.get("tags") or []),
            "visibility": "shared",
            "tier": "refined",
            "host_origin": str(payload.get("hostOrigin") or ("dot:" + actor)),
            "operation_id": str(payload.get("operationId") or "") or None,
        }
        new_id = builder.store(text, metadata)
        if not new_id:
            # 引擎判定为重复（同 hash）→ 纠正等于"内容已经一致"，如实返回而不是谎称新写。
            print(json.dumps({"ok": True, "id": "", "supersededId": old_id,
                              "action": "duplicate", "note": "新内容与库内既有条目重复，未新建"},
                             ensure_ascii=False))
            return 0

        older = builder._vector_store.get_chunk(old_id)  # 引擎内部只读访问；NotFound 走下面判断
        if older is None:
            print(json.dumps({"ok": False, "error": "旧条目不存在: %s" % old_id,
                              "id": new_id, "supersededId": old_id}, ensure_ascii=False))
            return 0
        if str(getattr(older, "namespace", "") or "") != namespace:
            # 跨域纠正一律拒绝：身份/域由配置给定，不接受越界。
            print(json.dumps({"ok": False, "error": "旧条目不属于当前域，拒绝纠正",
                              "id": new_id, "supersededId": old_id}, ensure_ascii=False))
            return 0

        store = VectorStore(db_path=db_path)
        retired = store.mark_superseded(old_id, new_id, reason=reason, by=actor)
        if not retired:
            print(json.dumps({"ok": False,
                              "error": "旧条目未被退役（可能已被退役或状态不是 active）",
                              "id": new_id, "supersededId": old_id}, ensure_ascii=False))
            return 0
        print(json.dumps({"ok": True, "id": new_id, "supersededId": old_id, "action": "corrected"},
                         ensure_ascii=False))
        return 0
    except Exception as exc:
        # 栈只写 stderr，stdout 保持单一 JSON；错误消息里不带正文。
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)},
                         ensure_ascii=False))
        return 0
    finally:
        try:
            if builder is not None:
                builder.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
