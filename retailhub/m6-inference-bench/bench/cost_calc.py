"""cost_calc.py —— 自建 vs 云 API 成本计算器（对应卷06 第 4 节与实战任务 7）。

成本模型的全部假设都写在注释里——财务备忘录能不能站住，取决于假设
是否显式。核心公式（与教程卷06 4.1/4.2 口径一致）：

  云 API 月成本 = 日token量 × 单价(元/token) × 30 天
  自建月成本   = 实例数 × GPU时价(元/卡时) × 24h × 30天
  所需实例数   = ceil( 日token量 / (单实例吞吐 tok/s × 86400s × 利用率) )
  盈亏平衡点   = 自建月固定成本 ÷ 云单价（月 token 量）

"利用率"是灵魂参数：GPU 是 24 小时付费的，但流量有峰谷。
按峰值买机器、按均值付账单——利用率 30% 时自建单位成本是满载的 3 倍多，
这就是教程常见误区第 5 条"自建一定省钱"的量化解释。

用法：
    python bench/cost_calc.py --daily-tokens 50            # 日 5000 万 token
    python bench/cost_calc.py --daily-tokens 50 --cloud-tier premium --gpu-price 12 --utilization 0.4
"""
import argparse
import math

# 云 API 档位表（元 / 百万 token，输入+输出混合后的教学向折算价）。
# 数字是教学占位，写备忘录时应替换为当时的真实刊例价。
CLOUD_TIERS = {
    "economy":  {"desc": "轻量模型档（如 7B 级 API）",   "price_per_mtok": 2.0},
    "standard": {"desc": "主力模型档（如中型旗舰 API）",  "price_per_mtok": 8.0},
    "premium":  {"desc": "前沿模型档（如顶级旗舰 API）",  "price_per_mtok": 40.0},
}

# GPU 实例档（教学占位）：单实例聚合吞吐 tok/s。
# 真实数字必须来自 load_test.py 的实测容量曲线拐点——不允许拍脑袋。
GPU_PROFILES = {
    "l20":   {"desc": "L20 48G 单卡，7B INT8",   "throughput": 800},
    "a10":   {"desc": "A10 24G 单卡，7B FP16",   "throughput": 500},
    "a100":  {"desc": "A100 80G 单卡，13B FP16", "throughput": 1500},
}


def cloud_monthly_cost(daily_tokens: float, tier: str) -> float:
    """云 API 月成本（元）。daily_tokens 单位：百万 token/天。"""
    return daily_tokens * CLOUD_TIERS[tier]["price_per_mtok"] * 30


def selfhost_instances(daily_tokens: float, gpu: str, utilization: float) -> int:
    """按吞吐反推实例数。日 token 量换算成平均 tok/s，再除以利用率修正。"""
    avg_tps = daily_tokens * 1_000_000 / 86400          # 平均吞吐需求 tok/s
    effective = GPU_PROFILES[gpu]["throughput"] * utilization  # 单实例有效吞吐
    return max(1, math.ceil(avg_tps / effective))


def selfhost_monthly_cost(instances: int, gpu_price_per_hour: float) -> float:
    """自建月成本（元）：GPU 无论忙闲 24 小时计费。"""
    return instances * gpu_price_per_hour * 24 * 30


def break_even_tokens(gpu_price_per_hour: float, tier: str, instances: int = 1) -> float:
    """盈亏平衡点（百万 token/月）：云花费等于自建固定成本时的用量。"""
    fixed = selfhost_monthly_cost(instances, gpu_price_per_hour)
    return fixed / CLOUD_TIERS[tier]["price_per_mtok"]


def main():
    ap = argparse.ArgumentParser(description="自建 vs 云 API 月成本对比")
    ap.add_argument("--daily-tokens", type=float, required=True,
                    help="日 token 量，单位：百万 token/天（输入+输出合计）")
    ap.add_argument("--cloud-tier", choices=CLOUD_TIERS.keys(), default="standard",
                    help="云 API 价格档位")
    ap.add_argument("--gpu", choices=GPU_PROFILES.keys(), default="a100",
                    help="自建 GPU 实例档")
    ap.add_argument("--gpu-price", type=float, default=12.0,
                    help="GPU 时价（元/卡时，含电费机位折算）")
    ap.add_argument("--utilization", type=float, default=0.35,
                    help="GPU 平均利用率 0~1（峰值容量 vs 均值流量的折算）")
    args = ap.parse_args()

    cloud = cloud_monthly_cost(args.daily_tokens, args.cloud_tier)
    n = selfhost_instances(args.daily_tokens, args.gpu, args.utilization)
    self_cost = selfhost_monthly_cost(n, args.gpu_price)
    be = break_even_tokens(args.gpu_price, args.cloud_tier)
    monthly_tokens = args.daily_tokens * 30

    tier = CLOUD_TIERS[args.cloud_tier]
    gpu = GPU_PROFILES[args.gpu]

    print("== 自建 vs 云 API 月成本对比 ==")
    print(f"输入: 日 token 量 = {args.daily_tokens} 百万  |  云档位 = {args.cloud_tier}"
          f"（{tier['price_per_mtok']} 元/百万tok, {tier['desc']}）")
    print(f"      GPU = {args.gpu}（{gpu['desc']}, {gpu['throughput']} tok/s）"
          f"  |  时价 = {args.gpu_price} 元/卡时  |  利用率 = {args.utilization:.0%}")
    print("-" * 64)
    print(f"云 API 月成本   = {args.daily_tokens} × {tier['price_per_mtok']} × 30"
          f" = {cloud:>12,.0f} 元")
    print(f"自建所需实例数  = ceil({args.daily_tokens}e6 / (86400 × {gpu['throughput']}"
          f" × {args.utilization})) = {n} 台")
    print(f"自建月成本      = {n} × {args.gpu_price} × 24 × 30"
          f" = {self_cost:>12,.0f} 元")
    print("-" * 64)
    print(f"每百万 token 单位成本:  云 = {tier['price_per_mtok']:.2f} 元"
          f"  |  自建 = {self_cost / monthly_tokens:.2f} 元")
    print(f"盈亏平衡点: 单台自建起步时，月用量达到 {be:,.0f} 百万 token"
          f"（≈ 日 {be / 30:,.1f} 百万）自建与云打平")
    verdict = "自建更便宜" if self_cost < cloud else "云 API 更便宜"
    print(f"结论（当前用量）: {verdict}，月差 {abs(self_cost - cloud):,.0f} 元。")
    print("提醒: 结论对利用率和 GPU 时价极其敏感——写备忘录前请用 "
          "load_test.py 的实测吞吐替换 GPU_PROFILES 里的占位数字。")


if __name__ == "__main__":
    main()
