# 001: Small Parcel Processing 计算规则

- **Status:** active
- **Priority:** medium
- **Tags:** small parcel, activity report, material, calculation
- **Created:** 2026-08-26
- **Updated:** 2026-08-26

## Summary

Small parcel processing 基于 activity report 中 material 表的不同规格 ID 对应的 QTY 计算

## Original Description

针对small parcel processing是针对activity report中material那个表里对应的不同规格ID对应的QTY来计算的

## Description

Small parcel processing 的计算逻辑：

计算依据来自 activity report 中的 material 表。具体来说，根据表中不同规格 ID（specification ID）对应的 QTY（数量）字段来进行计算。

这意味着：
- 每个 specification ID 会有对应的 QTY 值
- small parcel processing 的结果由这些规格-数量对决定

## Conditions

- 计算 small parcel processing 时

## Actions

- 从 activity report 的 material 表获取数据
- 按 specification ID 分组获取对应的 QTY
- 基于这些数据进行计算
