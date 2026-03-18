import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

export function FormCardSkeleton() {
  return (
    <Card className="overflow-hidden bg-white/80">
      <div className="h-1 bg-slate-200 animate-pulse" />
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="pt-4 border-t border-slate-100 flex gap-2">
          <Skeleton className="h-8 flex-1 rounded-md" />
          <Skeleton className="h-8 flex-1 rounded-md" />
        </div>
      </div>
    </Card>
  )
}

export function FormGridSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <FormCardSkeleton key={i} />
      ))}
    </div>
  )
}
