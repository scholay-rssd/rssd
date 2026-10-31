import bilibili from "../assets/platforms/bilibili.svg";
import douyin from "../assets/platforms/douyin.png";
import kuaishou from "../assets/platforms/kuaishou.svg";
import xiaohongshu from "../assets/platforms/xiaohongshu.png";
import weibo from "../assets/platforms/weibo.svg";
import toutiao from "../assets/platforms/toutiao.png";
import zhihu from "../assets/platforms/zhihu.svg";
import Icon from "./Icon";

const platformAssets: Record<string, string> = {
  bilibili,
  douyin,
  kuaishou,
  xiaohongshu,
  weibo,
  toutiao,
  zhihu,
};

interface Props {
  platformId: string;
  size?: number;
  className?: string;
}

/** Decorative brand mark; callers provide the adjacent platform name. */
export default function PlatformIcon({ platformId, size = 20, className }: Props) {
  const src = platformAssets[platformId];
  const classes = ["platform-icon", className].filter(Boolean).join(" ");
  if (!src) return <Icon name="globe" size={size} className={classes} />;

  return <img
    src={src}
    alt=""
    aria-hidden="true"
    draggable={false}
    className={classes}
    data-platform={platformId}
    width={size}
    height={size}
    style={{
      display: "block",
      width: size,
      height: size,
      flexShrink: 0,
      objectFit: "contain",
      borderRadius: 4,
    }}
  />;
}
