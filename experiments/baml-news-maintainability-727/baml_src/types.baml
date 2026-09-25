class NewsItem {
  title string
  summary string
  url string
  source string
  timestamp string?
  thumbnail string?
}

class NewsResult {
  news NewsItem[]
  summary string
}
