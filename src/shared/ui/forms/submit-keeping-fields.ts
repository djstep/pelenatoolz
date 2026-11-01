import { startTransition, type FormEvent } from "react";

/**
 * Обработчик onSubmit для формы с действием из useActionState — вместо action={action}.
 * React 19 после отправки через action={…} возвращает все поля без состояния
 * (defaultValue / defaultChecked) к исходным, и при ошибке сервера тоже — введённое пропадает.
 * Здесь отправку запускаем сами: поля остаются как есть, pending из useActionState работает.
 * Кнопка, которой отправили форму, попадает в данные (name/value у нескольких кнопок).
 * Повторную отправку, как и раньше, не даёт кнопка с disabled={pending}.
 */
export function submitKeepingFields(action: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => action(formData));
  };
}
