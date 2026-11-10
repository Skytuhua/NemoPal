// Adapted from shadcn-ui/ui@42f3bb63; MIT. Exact source hashes: provenance.json.
import { cn } from "./utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
