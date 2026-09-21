#!/usr/bin/env bash
# RetailHub 实操源码包 · 一键环境准备
# 用法：cd labs && bash bootstrap.sh
set -e
cd "$(dirname "$0")"

echo "== 1/4 检测 python3 =="
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 没找到 python3。macOS 请先执行：xcode-select --install（或 brew install python3）"
  exit 1
fi
PYVER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || {
  echo "❌ 当前 python3 版本 $PYVER，需要 ≥ 3.10。请升级后重试。"
  exit 1
}
echo "   python3 版本 $PYVER ✅"

echo "== 2/4 创建虚拟环境 .venv =="
if [ ! -d .venv ]; then
  python3 -m venv .venv
  echo "   已创建 .venv ✅"
else
  echo "   .venv 已存在，跳过 ✅"
fi

echo "== 3/4 安装依赖（requirements-all.txt）=="
if ! ./.venv/bin/pip install -q -r requirements-all.txt; then
  echo "⚠️ 默认源安装失败，切换清华镜像重试……"
  ./.venv/bin/pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements-all.txt
fi
echo "   依赖安装完成 ✅"

echo "== 4/4 自检 =="
./.venv/bin/python -c 'import fastapi, uvicorn, fakeredis, httpx, pytest; print("   核心依赖导入正常 ✅")'

cat <<'EOF'

🎉 环境就绪。下一步：

   source .venv/bin/activate   # 激活虚拟环境（每次新开终端都要）

然后挑一个里程碑开始（推荐从 M1 起步）：

   cd m1-monolith && bash run.sh    # 起服务后按该目录 README 的验收表 curl 验证

里程碑地图与各目录的学习目标见根 README.md。
EOF
