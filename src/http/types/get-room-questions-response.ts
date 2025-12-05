export type GetRoomQuestionsResponse = Array<{
  id: string
  question: string
  createdAt: string
  answer?: string | null
  isGeneratingAnswer?: boolean
}>
