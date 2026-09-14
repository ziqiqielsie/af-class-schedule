# AF 团课课表

把 7 家 Anytime Fitness 的团课海报收成一个手机、电脑都能打开的课表页。默认按「今天」列出各店课程，也可以按门店看整周。

## 怎么打开

在项目目录运行：

```bash
python3 -m http.server 4173
```

然后：

- 电脑：打开 http://127.0.0.1:4173
- 同一 Wi-Fi 下的手机：打开 `http://<你电脑的局域网 IP>:4173`

Safari / Chrome 里可以用「添加到主屏幕」，之后离线也能看。

## 以后怎么改课表

应用里点 **编辑课表**：

- 添加 / 删除门店
- 给某家店加一节课、改一节课、删一节课
- **批量/替换**：按行粘贴新课表，可追加或整份替换
- **导出 JSON** / **导入 JSON**：换手机或备份时用
- **恢复原始课表**：回到第一次从海报录入的版本

浏览器里的修改存在这台设备的 localStorage。想变成所有设备的默认数据，把导出的 JSON 包进 `data/schedules.js`：

```js
window.AF_SEED = { ...导出的内容 };
```

批量粘贴格式示例：

```
周一 19:00-20:00 Yoga
Tue 7:00pm-8:00pm HIIT | Shaun
Wed 18:30-19:30 Pilates | Levian
```

## 已录入门店

Mountbatten、Marine Parade XXL、Katong、Pasir Panjang、Wheelock Place、MacPherson Mall、Cecil Street。

Cecil Street 海报没写下课时间，按 1 小时估的；周五中午那格原图被遮住，按 Yoga 12:15 录入，不对可以在编辑里改。
