export interface PostImage {
  url: string
  name: string
}

export interface MessageBoardPost {
  id: string
  sub_account: string
  subject: string
  content: string
  images: PostImage[]
  posted_by: string | null
  posted_at: string
  expires_at: string | null
  created_at: string
  updated_at: string
  poster?: { name: string } | null
}
