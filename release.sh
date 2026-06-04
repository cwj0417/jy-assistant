#!/bin/bash
# 打tag并推送触发GitHub Actions构建
# 用法: ./release.sh [版本号]
# 示例: ./release.sh 1.0.1

VERSION=${1}

if [ -z "$VERSION" ]; then
  # 从package.json读取当前版本
  VERSION=$(node -p "require('./package.json').version")
  echo "未指定版本号，使用 package.json 中的版本: v$VERSION"
else
  # 更新package.json版本号
  npm version "$VERSION" --no-git-tag-version
  echo "已更新 package.json 版本为: v$VERSION"
fi

TAG="v$VERSION"

echo "创建tag: $TAG"
git add package.json
git commit -m "chore: release $TAG" 2>/dev/null || true
git tag "$TAG"
git push origin main --tags

echo "已推送 $TAG，GitHub Actions 将自动构建"
