// Re-exportar componentes de shadcn/ui y personalizados
export { Button, buttonVariants } from './components/button'
export { Input } from './components/input'
export { Textarea } from './components/textarea'
export { Label } from './components/label'
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/select'
export { Checkbox } from './components/checkbox'
export { RadioGroup, RadioGroupItem } from './components/radio-group'
export { Switch } from './components/switch'
export { Slider } from './components/slider'
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/card'
export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './components/dialog'
export { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './components/alert-dialog'
export { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from './components/sheet'
export { Popover, PopoverContent, PopoverTrigger } from './components/popover'
export { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from './components/dropdown-menu'
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/tooltip'
export { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs'
export { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './components/accordion'
export { Badge, badgeVariants } from './components/badge'
export { Avatar, AvatarFallback, AvatarImage } from './components/avatar'
export { Progress } from './components/progress'
export type { ProgressProps } from './components/progress'
export { Skeleton } from './components/skeleton'
export { Separator } from './components/separator'
export { Toaster, toast } from './components/toaster'
export { DataTable } from './components/data-table'

// Componentes personalizados para el SaaS
export { TarjetaSellos } from './components/tarjeta-sellos'
export type { TarjetaSellosProps, EstadoTarjeta, TamanoTarjeta } from './components/tarjeta-sellos'
export { GoogleReviews } from './components/google-reviews'
export type { GoogleReviewsProps, Resena } from './components/google-reviews'
export { BottomSheet } from './components/bottom-sheet'
export type { BottomSheetProps, AlturaSheet } from './components/bottom-sheet'

// Utilidades
export { cn } from './lib/utils'

// NOTA: no se importa aca './styles/globals.css' a proposito. Un package no debe
// inyectar CSS global a sus consumidores: Next solo admite CSS global en el root
// layout y ademas forzaria a las PWAs de Staff/Admin a cargar este archivo.
// Cada app define su globals.css (y puede copiar los tokens de este package).
export { ImagenOptimizada } from './components/imagen-optimizada'
export type { ImagenOptimizadaProps } from './components/imagen-optimizada'
// Helpers puros de imagen: van aparte para poder testearlos desde node sin React.
export { urlOptimizada, ANCHO_POR_TIPO, RATIO_POR_TIPO } from './lib/url-optimizada'
export type { TipoImagenOptimizada } from './lib/url-optimizada'
