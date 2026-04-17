import { Icon } from "@/components/ui/icon";

export function PagePlaceholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
      <Icon name="construction" size={48} className="text-muted-foreground/50 mb-4" />
      <h1 className="text-2xl font-semibold mb-2">{title}</h1>
      {description && (
        <p className="text-muted-foreground max-w-md">{description}</p>
      )}
    </div>
  );
}
