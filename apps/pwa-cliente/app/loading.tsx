import { Skeleton } from '@repo/ui'

export default function Loading() {
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-64 w-full" />
    </main>
  )
}
