// Favorite runs of this phone: there can be several, and looking at a run doesn't change them.
import { ref } from 'vue';
import { load, save } from '../storage.ts';

export function useFavorites() {
  // Older versions stored one run instead of a list.
  const favorites = ref([load<number | number[]>('ehbo.favoriteRun') ?? []].flat());

  function toggleFavorite(id: number) {
    favorites.value = favorites.value.includes(id) ? favorites.value.filter((f) => f !== id) : [...favorites.value, id];
    save('ehbo.favoriteRun', favorites.value);
  }

  return { favorites, toggleFavorite };
}
