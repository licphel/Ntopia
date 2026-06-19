<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:atom="http://www.w3.org/2005/Atom">
<xsl:output method="html" encoding="utf-8" indent="yes"/>
<xsl:template match="/">
<html lang="zh-CN">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Ntopia RSS</title>
<style>body{font:14px/1.7 Georgia,serif;max-width:720px;margin:20px auto;padding:0 16px;background:#fafaf5;color:#333}h1{font-size:22px;border-bottom:2px solid #6b8c42;padding-bottom:8px}.item{margin:20px 0;padding:16px;background:#fff;border:1px solid #e0dbd0;border-radius:3px}.item h2{font-size:17px;margin:0 0 4px}.item h2 a{color:#6b8c42;text-decoration:none}.meta{font-size:11px;color:#999;margin-bottom:8px}.desc{font-size:13px;color:#555;line-height:1.7}a{color:#6b8c42}</style></head>
<body><h1>Ntopia RSS</h1><p><xsl:value-of select="rss/channel/description"/></p>
<xsl:for-each select="rss/channel/item">
<div class="item">
<h2><a href="{link}"><xsl:value-of select="title"/></a></h2>
<div class="meta">By <xsl:value-of select="author"/> | <xsl:value-of select="pubDate"/></div>
<div class="desc"><xsl:value-of select="description"/></div>
</div>
</xsl:for-each>
<hr/><p style="color:#999;font-size:12px">订阅地址：<a href="/rss.xml"><xsl:value-of select="rss/channel/atom:link/@href"/></a></p></body></html>
</xsl:template>
</xsl:stylesheet>
