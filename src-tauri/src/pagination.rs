#[derive(Debug, Default)]
pub(crate) struct OffsetPager {
    offset: u64,
}

impl OffsetPager {
    pub(crate) fn offset(&self) -> u64 {
        self.offset
    }

    pub(crate) fn advance(
        &mut self,
        received: usize,
        total: Option<u64>,
        resource: &str,
    ) -> Result<bool, String> {
        let received =
            u64::try_from(received).map_err(|_| format!("{resource} 分页数量超出支持范围"))?;

        if received == 0 {
            if total.is_some_and(|total| self.offset < total) {
                return Err(format!(
                    "{resource} 分页提前结束：已获取 {} 条，服务端报告共 {} 条",
                    self.offset,
                    total.unwrap_or_default()
                ));
            }
            return Ok(false);
        }

        let next_offset = self
            .offset
            .checked_add(received)
            .ok_or_else(|| format!("{resource} 分页偏移量溢出"))?;

        if let Some(total) = total {
            if next_offset > total {
                return Err(format!(
                    "{resource} 分页总量不一致：已获取 {next_offset} 条，服务端报告共 {total} 条"
                ));
            }
        }

        self.offset = next_offset;
        Ok(total != Some(next_offset))
    }
}

#[derive(Debug)]
pub(crate) struct PageNumberPager {
    page: u64,
    fetched: u64,
}

impl Default for PageNumberPager {
    fn default() -> Self {
        Self {
            page: 1,
            fetched: 0,
        }
    }
}

impl PageNumberPager {
    pub(crate) fn page(&self) -> u64 {
        self.page
    }

    pub(crate) fn advance(
        &mut self,
        received: usize,
        total_pages: Option<u64>,
        total_items: Option<u64>,
        resource: &str,
    ) -> Result<bool, String> {
        let received =
            u64::try_from(received).map_err(|_| format!("{resource} 分页数量超出支持范围"))?;

        if received == 0 {
            let more_pages = total_pages.is_some_and(|total| self.page < total);
            let more_items = total_items.is_some_and(|total| self.fetched < total);
            if more_pages || more_items {
                return Err(format!(
                    "{resource} 分页提前结束：已获取 {} 条，当前第 {} 页",
                    self.fetched, self.page
                ));
            }
            return Ok(false);
        }

        self.fetched = self
            .fetched
            .checked_add(received)
            .ok_or_else(|| format!("{resource} 分页累计数量溢出"))?;

        let pages_complete = match total_pages {
            Some(total) if self.page > total => {
                return Err(format!(
                    "{resource} 分页总页数不一致：当前第 {} 页，服务端报告共 {total} 页",
                    self.page
                ));
            }
            Some(total) => Some(self.page == total),
            None => None,
        };
        let items_complete = match total_items {
            Some(total) if self.fetched > total => {
                return Err(format!(
                    "{resource} 分页总量不一致：已获取 {} 条，服务端报告共 {total} 条",
                    self.fetched
                ));
            }
            Some(total) => Some(self.fetched == total),
            None => None,
        };

        if let (Some(pages_complete), Some(items_complete)) = (pages_complete, items_complete) {
            if pages_complete != items_complete {
                return Err(format!("{resource} 分页总页数与总条数不一致"));
            }
        }

        if pages_complete == Some(true) || items_complete == Some(true) {
            return Ok(false);
        }

        self.page = self
            .page
            .checked_add(1)
            .ok_or_else(|| format!("{resource} 分页页码溢出"))?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offset_pager_advances_by_actual_page_length() {
        let mut pager = OffsetPager::default();

        assert!(pager.advance(3_000, Some(7_001), "DNSPod 域名").unwrap());
        assert_eq!(pager.offset(), 3_000);
        assert!(pager.advance(3_000, Some(7_001), "DNSPod 域名").unwrap());
        assert_eq!(pager.offset(), 6_000);
        assert!(!pager.advance(1_001, Some(7_001), "DNSPod 域名").unwrap());
        assert_eq!(pager.offset(), 7_001);
    }

    #[test]
    fn offset_pager_uses_an_empty_page_when_total_is_missing() {
        let mut pager = OffsetPager::default();

        assert!(pager.advance(2, None, "DNSPod 记录").unwrap());
        assert_eq!(pager.offset(), 2);
        assert!(!pager.advance(0, None, "DNSPod 记录").unwrap());
    }

    #[test]
    fn offset_pager_rejects_an_early_empty_page() {
        let mut pager = OffsetPager::default();
        pager.advance(3, Some(5), "DNSPod 记录").unwrap();

        let error = pager.advance(0, Some(5), "DNSPod 记录").unwrap_err();
        assert!(error.contains("分页提前结束"));
    }

    #[test]
    fn page_number_pager_does_not_silently_stop_at_old_caps() {
        let mut pager = PageNumberPager {
            page: 50,
            fetched: 2_450,
        };

        assert!(pager
            .advance(50, Some(51), Some(2_550), "Cloudflare 域名")
            .unwrap());
        assert_eq!(pager.page(), 51);
        assert!(!pager
            .advance(50, Some(51), Some(2_550), "Cloudflare 域名")
            .unwrap());
    }

    #[test]
    fn page_number_pager_continues_without_metadata_until_empty() {
        let mut pager = PageNumberPager::default();

        assert!(pager.advance(500, None, None, "火山引擎记录").unwrap());
        assert_eq!(pager.page(), 2);
        assert!(!pager.advance(0, None, None, "火山引擎记录").unwrap());
    }

    #[test]
    fn page_number_pager_rejects_conflicting_totals() {
        let mut pager = PageNumberPager::default();

        let error = pager
            .advance(50, Some(1), Some(51), "Cloudflare 域名")
            .unwrap_err();
        assert!(error.contains("总页数与总条数不一致"));
    }
}
