import * as Icons from "lucide-react";

interface LucideIconProps {
  name: string;
  className?: string;
  size?: number;
}

export default function LucideIcon({ name, className = "", size = 24 }: LucideIconProps) {
  // Lucideアイコンオブジェクトから動的に取得。なければCircleHelp、Info、Heartをフォールバック
  const IconComponent = (Icons as any)[name] || Icons.CircleHelp || Icons.Info || Icons.Heart;
  return <IconComponent className={className} size={size} />;
}
