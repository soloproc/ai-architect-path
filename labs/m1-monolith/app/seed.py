"""确定性种子数据：50 个商品、约 5000 张订单，跨 30 天。

教学要点：
- random.seed(42) 固定随机源，任何人跑出来的数据完全一致——
  教程的验收数字、测试断言才能稳定复现。这是"可重复环境"的基本功。
- 订单时间均匀分布在 2025-06-01 ~ 2025-06-30，状态约 1/10 为 refunded，
  用来支撑卷01 的"GMV 不计退款"口径决策（见 docs/adr/0001）。
"""
import random
from datetime import datetime, timedelta

from .db import get_conn, init_db, table_empty

SEED = 42
N_ITEMS = 50
N_ORDERS = 5000
START_DATE = datetime(2025, 6, 1)
DAYS = 30

CATEGORIES = ["饮品", "零食", "生鲜", "日百", "烘焙"]
NAME_POOL = {
    "饮品": ["美式咖啡", "拿铁", "气泡水", "橙汁", "乌龙茶"],
    "零食": ["薯片", "坚果礼盒", "巧克力", "饼干", "肉脯"],
    "生鲜": ["有机鸡蛋", "牛排", "三文鱼", "菠菜", "蓝莓"],
    "日百": ["抽纸", "洗衣液", "垃圾袋", "牙膏", "雨伞"],
    "烘焙": ["全麦吐司", "可颂", "蛋挞", "芝士蛋糕", "贝果"],
}


def seed() -> None:
    init_db()
    if not table_empty("orders"):
        print("已有数据，跳过 seed（如需重建请先删除 retailhub.db）")
        return
    rng = random.Random(SEED)

    items = []
    for i in range(1, N_ITEMS + 1):
        cat = CATEGORIES[(i - 1) % len(CATEGORIES)]
        name = f"{NAME_POOL[cat][(i - 1) // len(CATEGORIES) % 5]}-{i:02d}"
        price = round(rng.uniform(3, 300), 2)
        items.append((i, name, cat, price))

    orders, order_items = [], []
    for oid in range(1, N_ORDERS + 1):
        day_offset = rng.randrange(DAYS)
        created = START_DATE + timedelta(
            days=day_offset, hours=rng.randrange(8, 22), minutes=rng.randrange(60)
        )
        status = "refunded" if rng.random() < 0.1 else "paid"
        # 每张订单 1~3 个商品行；总额 = 明细合计，保证 JOIN 明细与 amount 对得上
        total = 0.0
        for item in rng.sample(items, rng.randint(1, 3)):
            qty = rng.randint(1, 5)
            total += item[3] * qty
            order_items.append((oid, item[0], qty, item[3]))
        orders.append((oid, rng.randint(1, 2000), rng.randint(1, 20),
                       status, round(total, 2), created.strftime("%Y-%m-%d %H:%M:%S")))

    conn = get_conn()
    try:
        conn.executemany("INSERT INTO items VALUES (?,?,?,?)", items)
        conn.executemany("INSERT INTO orders VALUES (?,?,?,?,?,?)", orders)
        conn.executemany("INSERT INTO order_items VALUES (?,?,?,?)", order_items)
        conn.commit()
    finally:
        conn.close()
    print(f"seed 完成：{len(items)} 商品 / {len(orders)} 订单 / {len(order_items)} 明细行")


if __name__ == "__main__":
    seed()
