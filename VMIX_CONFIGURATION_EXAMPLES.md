# vMix 配置示例

## 概述

本文档提供了使用 vMix Data Manager 的配置示例，展示了如何在 vMix 中配置数据源以获取实时数据。

## 基本配置

### 1. 添加数据源

在 vMix 中，按照以下步骤添加数据源：

1. 打开 vMix
2. 点击 "Settings"（设置）
3. 选择 "Data Sources"（数据源）
4. 点击 "Add"（添加）
5. 选择 "Web Browser"（网页浏览器）
6. 在 URL 字段中输入以下地址之一：

#### JSON 格式（默认）
```
http://localhost:8088/api/data/myprofile
```

#### XML 格式
```
http://localhost:8088/api/data/myprofile?format=xml
```

#### 纯文本格式
```
http://localhost:8088/api/data/myprofile?format=text
```

### 2. 配置刷新间隔

建议将刷新间隔设置为 1-5 秒，以获得实时数据更新：

1. 在数据源设置中找到 "Refresh Interval"（刷新间隔）
2. 设置为 1000ms (1秒) 到 5000ms (5秒) 之间

## 高级配置示例

### 1. 使用字段过滤

如果只想获取特定字段的数据，可以使用 `include` 或 `exclude` 参数：

#### 只包含特定字段
```
http://localhost:8088/api/data/myprofile?include=name,age
```

#### 排除特定字段
```
http://localhost:8088/api/data/myprofile?exclude=password,email
```

### 2. 在字幕中使用数据

在 vMix 字幕中使用数据的示例：

#### JSON 数据格式
假设您的数据如下：
```json
{
  "name": "John Doe",
  "age": 30,
  "title": "Software Engineer"
}
```

在字幕中可以这样使用：
```
姓名: {name}
年龄: {age}
职位: {title}
```

#### XML 数据格式
如果使用 XML 格式，字幕中可以这样使用：
```
姓名: {data.name}
年龄: {data.age}
职位: {data.title}
```

#### 纯文本格式
如果使用纯文本格式，您需要根据实际的文本格式进行调整。

### 3. 远程访问配置

如果需要从远程计算机访问 vMix Data Manager，需要提供 API 密钥：

```
http://your-server-ip:8088/api/data/myprofile?api_key=your-api-key
```

## 常见问题解答

### 1. 为什么我在 vMix 中看不到数据？

- 检查 vMix Data Manager 是否正在运行
- 检查 URL 是否正确
- 检查防火墙设置是否阻止了连接
- 检查配置文件是否存在

### 2. 如何创建新的配置文件？

可以通过 API 创建新的配置文件：

```bash
# 添加一个新的数据项到配置文件
curl -X POST "http://localhost:8088/api/items/myprofile" \
  -H "Content-Type: application/json" \
  -d '{"key": "name", "value": "John Doe"}'
```

### 3. 如何更新现有数据？

可以通过 API 更新现有数据：

```bash
# 更新配置文件中的数据项
curl -X PUT "http://localhost:8088/api/items/myprofile/name" \
  -H "Content-Type: application/json" \
  -d '{"value": "Jane Doe"}'
```

### 4. 如何删除数据项？

可以通过 API 删除数据项：

```bash
# 删除配置文件中的数据项
curl -X DELETE "http://localhost:8088/api/items/myprofile/name"
```

## 故障排除

### 1. 连接被拒绝

- 确保 vMix Data Manager 正在运行
- 检查端口是否正确（默认为 8088）
- 检查防火墙设置

### 2. 数据格式不正确

- 确保在 vMix 中正确配置了数据源格式
- 检查数据是否符合预期格式

### 3. 访问被拒绝（403 错误）

- 如果从远程计算机访问，确保提供了正确的 API 密钥
- 检查 API 密钥是否正确配置

## 最佳实践

### 1. 性能优化

- 合理设置刷新间隔，避免过于频繁的请求
- 使用字段过滤只获取需要的数据
- 在本地网络中运行以获得最佳性能

### 2. 安全性

- 如果从远程访问，使用强 API 密钥
- 不要在配置文件中存储敏感信息
- 定期更新 API 密钥

### 3. 数据管理

- 使用有意义的配置文件名称
- 定期备份配置文件
- 使用版本控制管理配置文件