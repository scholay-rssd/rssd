# Platform icons

These local assets identify the platform next to its name in the desktop UI.
They are bundled with the app; rendering makes no network request. The brand
colors and icon shapes are preserved for recognition in light and dark themes.

## Simple Icons vectors

`bilibili.svg`, `kuaishou.svg`, `weibo.svg`, and `zhihu.svg` come from
[Simple Icons](https://github.com/simple-icons/simple-icons), pinned to commit
`98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d` (retrieved 2026-10-05).
The SVG path geometry is unchanged; an explicit fill uses the upstream brand
color. Upstream's CC0-1.0 text is included in `simple-icons-LICENSE.md`.
Brand and trademark rights remain with their respective owners.

| Local file | Upstream icon | Upstream recorded brand source | Color |
| --- | --- | --- | --- |
| `bilibili.svg` | [bilibili.svg](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/bilibili.svg) | [Bilibili](https://www.bilibili.com/) | `#00A1D6` |
| `kuaishou.svg` | [kuaishou.svg](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/kuaishou.svg) | [Kuaishou official material library](https://www.kuaishou.com/official/material-lib) | `#FF4906` |
| `weibo.svg` | [sinaweibo.svg](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/sinaweibo.svg) | [Sina Weibo entry](https://en.wikipedia.org/wiki/Sina_Weibo) | `#E6162D` |
| `zhihu.svg` | [zhihu.svg](https://github.com/simple-icons/simple-icons/blob/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d/icons/zhihu.svg) | [Zhihu](https://www.zhihu.com/) | `#0084FF` |

## Official website icons

The following icons were retrieved from the platform websites on 2026-10-05.
They remain the respective platforms' assets, used here only to identify their
platform. No open copyright license is asserted for these files.

| Local file | Source | Processing |
| --- | --- | --- |
| `douyin.png` | [Douyin favicon](https://www.douyin.com/favicon.ico) | ICO converted to PNG, original 32×32 appearance preserved |
| `toutiao.png` | [Toutiao favicon](https://sf3-cdn-tos.douyinstatic.com/obj/eden-cn/uhbfnupkbps/toutiao_favicon.ico), linked by [Toutiao's homepage](https://www.toutiao.com/) | ICO converted to PNG, original 256×256 appearance preserved |
| `xiaohongshu.png` | [Xiaohongshu touch icon](https://picasso-static.xiaohongshu.com/fe-platform/f43dc4a8baf03678996c62d8db6ebc01a82256ff.png), linked by [Xiaohongshu's homepage](https://www.xiaohongshu.com/) | Original 180×180 PNG |

`PlatformIcon` uses a neutral globe for an unknown platform identifier. Every
brand icon is decorative because the UI also supplies the readable platform name.
