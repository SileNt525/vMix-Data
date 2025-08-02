# vMix Data Manager API 文档

## 概述

vMix Data Manager 是一个为 vMix 字幕设计的实时数据源管理器。它提供了一个 HTTP API，允许 vMix 轮询获取最新的数据，并支持多种数据格式。

## API 端点

### 获取数据端点

#### 端点
```
GET /api/data/:profileName
```

#### 参数
- `profileName` (路径参数): 配置文件名称
- `format` (查询参数, 可选): 数据格式，支持 `json` (默认), `xml`, `text`
- `include` (查询参数, 可选): 包含的字段列表，用逗号分隔
- `exclude` (查询参数, 可选): 排除的字段列表，用逗号分隔
- `api_key` (查询参数, 可选): API 密钥（非本地访问时必需）

#### 响应头
- `Content-Type`: 根据请求的格式返回相应的内容类型
- `Cache-Control`: `public, max-age=60`
- `ETag`: 数据的时间戳

#### 示例请求
```bash
# 获取 JSON 格式数据
curl "http://localhost:8088/api/data/myprofile"

# 获取 XML 格式数据
curl "http://localhost:8088/api/data/myprofile?format=xml"

# 获取纯文本格式数据
curl "http://localhost:8088/api/data/myprofile?format=text"

# 过滤数据，只包含特定字段
curl "http://localhost:8088/api/data/myprofile?include=name,age"

# 过滤数据，排除特定字段
curl "http://localhost:8088/api/data/myprofile?exclude=password,email"
```

### 获取配置文件数据项列表

#### 端点
```
GET /api/items/:profileName
```

#### 参数
- `profileName` (路径参数): 配置文件名称
- `api_key` (查询参数, 可选): API 密钥（非本地访问时必需）

#### 示例请求
```bash
curl "http://localhost:8088/api/items/myprofile"
```

### 添加数据项

#### 端点
```
POST /api/items/:profileName
```

#### 参数
- `profileName` (路径参数): 配置文件名称
- `api_key` (查询参数, 可选): API 密钥（非本地访问时必需）

#### 请求体
```json
{
  "key": "字段名",
  "value": "字段值"
}
```

#### 示例请求
```bash
curl -X POST "http://localhost:8088/api/items/myprofile" \
  -H "Content-Type: application/json" \
  -d '{"key": "name", "value": "John Doe"}'
```

### 更新数据项

#### 端点
```
PUT /api/items/:profileName/:key
```

#### 参数
- `profileName` (路径参数): 配置文件名称
- `key` (路径参数): 字段名
- `api_key` (查询参数, 可选): API 密钥（非本地访问时必需）

#### 请求体
```json
{
  "value": "新字段值"
}
```

#### 示例请求
```bash
curl -X PUT "http://localhost:8088/api/items/myprofile/name" \
  -H "Content-Type: application/json" \
  -d '{"value": "Jane Doe"}'
```

### 删除数据项

#### 端点
```
DELETE /api/items/:profileName/:key
```

#### 参数
- `profileName` (路径参数): 配置文件名称
- `key` (路径参数): 字段名
- `api_key` (查询参数, 可选): API 密钥（非本地访问时必需）

#### 示例请求
```bash
curl -X DELETE "http://localhost:8088/api/items/myprofile/name"
```

## 访问控制

### 本地访问
来自 `127.0.0.1` 或 `::1` 的请求被视为本地访问，无需 API 密钥。

### 远程访问
来自其他 IP 地址的请求需要提供 API 密钥：
- 通过 `X-API-Key` 请求头
- 通过 `api_key` 查询参数

默认 API 密钥为 `vmix-default-api-key`，可以通过环境变量 `VMIX_API_KEY` 进行配置。

## 数据格式

### JSON (默认)
```json
{
  "name": "John Doe",
  "age": 30,
  "email": "john@example.com"
}
```

### XML
```xml
<?xml version="1.0" encoding="UTF-8"?>
<data>
  <name>John Doe</name>
  <age>30</age>
  <email>john@example.com</email>
</data>
```

### 纯文本
```
name: John Doe
age: 30
email: john@example.com
```

## 缓存策略

API 使用内存缓存来提高性能，缓存过期时间为 5 分钟。响应包含适当的缓存头以支持客户端缓存。

## 错误处理

API 使用标准的 HTTP 状态码来表示请求的结果：
- `200`: 请求成功
- `201`: 创建成功
- `400`: 请求参数错误
- `403`: 访问被拒绝
- `404`: 资源未找到
- `500`: 服务器内部错误

错误响应格式：
```json
{
  "error": "错误描述"
}