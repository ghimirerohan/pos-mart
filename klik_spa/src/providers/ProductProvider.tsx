import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { MenuItem } from '../../types';
import { useAuth } from '../hooks/useAuth';

interface ProductContextType {
  products: MenuItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshingStock: boolean;
  isSearching: boolean;
  error: string | null;
  refetchProducts: () => Promise<void>;
  refreshStockOnly: () => Promise<boolean>;
  updateStockOnly: (itemCode: string, newStock: number) => void;
  updateStockForItems: (itemCodes: string[]) => Promise<void>;
  updateBatchQuantitiesForItems: (itemCodes: string[]) => Promise<void>;
  loadMoreProducts: () => Promise<void>;
  searchProducts: (query: string) => Promise<void>;
  clearSearch: () => void;
  count: number;
  totalCount: number;
  hasMore: boolean;
  lastUpdated: Date | null;
  searchQuery: string;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

interface ProductProviderProps {
  children: ReactNode;
}

// Pagination configuration (smaller pages; load more on scroll — see ProductGrid, ItemsPage, POS layouts)
const PAGE_SIZE = 80;
const LOAD_MORE_SIZE = 80;

export function ProductProvider({ children }: ProductProviderProps) {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [isRefreshingStock, setIsRefreshingStock] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Pagination state
  const [totalCount, setTotalCount] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [currentOffset, setCurrentOffset] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Ref to track if we're currently searching (to prevent race conditions)
  const searchAbortController = useRef<AbortController | null>(null);

  // Fetch products from API with pagination
  const fetchProductsFromAPI = async (
    limit: number = PAGE_SIZE,
    offset: number = 0,
    search: string = '',
    category: string = ''
  ): Promise<{
    items: MenuItem[];
    total_count: number;
    has_more: boolean;
  }> => {
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });

      if (search) {
        params.append('search', search);
      }
      if (category && category !== 'all') {
        params.append('category', category);
      }
      const response = await fetch(
        `/api/method/klik_pos.api.item.get_items_with_balance_and_price?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const resData = await response.json();
      console.log('[Products] Raw response payload', resData);

      const message = resData?.message ?? resData;

      // Common shape: { items: [...], total_count, has_more }
      if (message && typeof message === 'object') {
        const maybeItems =
          (message as any).items ??
          (message as any).data ??
          (message as any).results ??
          (resData as any).items;

        if (maybeItems !== undefined) {
          const itemsArray = Array.isArray(maybeItems) ? maybeItems : Object.values(maybeItems);
          console.log('[Products] Parsed items array length', itemsArray.length, {
            total_count: (message as any).total_count,
            has_more: (message as any).has_more,
            offset,
            limit,
            search,
          });
          return {
            items: itemsArray,
            total_count: (message as any).total_count ?? itemsArray.length ?? 0,
            has_more: Boolean((message as any).has_more),
          };
        }

        // If items missing but counts exist, return empty array (fail-open)
        if ((message as any).total_count !== undefined || (message as any).has_more !== undefined) {
          console.warn('[Products] No items but counts present', {
            total_count: (message as any).total_count,
            has_more: (message as any).has_more,
            offset,
            limit,
            search,
          });
          return {
            items: [],
            total_count: (message as any).total_count ?? 0,
            has_more: Boolean((message as any).has_more),
          };
        }
      }

      // Old shape: { message: [...] }
      if (Array.isArray(message)) {
        return {
          items: message,
          total_count: message.length,
          has_more: false,
        };
      }

      // Defensive: double-wrapped { message: { items: ... } }
      if (message?.message) {
        const inner = message.message;
        const innerItems = inner.items ?? inner.data ?? inner.results;
        if (innerItems !== undefined) {
          const itemsArray = Array.isArray(innerItems) ? innerItems : Object.values(innerItems);
          console.log('[Products] Parsed inner items array length', itemsArray.length, {
            total_count: inner.total_count,
            has_more: inner.has_more,
            offset,
            limit,
            search,
          });
          return {
            items: itemsArray,
            total_count: inner.total_count ?? itemsArray.length ?? 0,
            has_more: Boolean(inner.has_more),
          };
        }
        if (inner.total_count !== undefined || inner.has_more !== undefined) {
          console.warn('[Products] No inner items but counts present', {
            total_count: inner.total_count,
            has_more: inner.has_more,
            offset,
            limit,
            search,
          });
          return {
            items: [],
            total_count: inner.total_count ?? 0,
            has_more: Boolean(inner.has_more),
          };
        }
      }

      console.error('Invalid response format:', resData, { offset, limit, search, category });
      // Fail-open: return empty structure to avoid blocking UI while we inspect
      return {
        items: [],
        total_count: 0,
        has_more: false,
      };
    } catch (err) {
      console.error('[Products] fetchProductsFromAPI error (fail-open)', err, { offset, limit, search, category });
      return {
        items: [],
        total_count: 0,
        has_more: false,
      };
    }
  };

  // Fetch only stock updates - with fallback to batch API
  const fetchStockUpdates = async (): Promise<{
    updates: Record<string, number>;
    fetched: boolean;
  }> => {
    try {
      // For large catalogs, only update stock for currently loaded items
      const itemCodesJson = JSON.stringify(products.map((p) => p.id));
      if (!itemCodesJson || itemCodesJson === '[]')
        return { updates: {}, fetched: false };

      const batchResponse = await fetch(
        `/api/method/klik_pos.api.item.get_items_stock_batch?item_codes=${encodeURIComponent(itemCodesJson)}`
      );

      if (batchResponse.ok) {
        const batchData = await batchResponse.json();
        const msg = batchData?.message;
        if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
          return { updates: msg as Record<string, number>, fetched: true };
        }
      }
      return { updates: {}, fetched: false };
    } catch (error) {
      console.error('Error fetching stock updates:', error);
      return { updates: {}, fetched: false };
    }
  };

  // Initial fetch of products with pagination
  const fetchProducts = async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);
    setSearchQuery(''); // Clear search on initial fetch

    try {
      const result = await fetchProductsFromAPI(PAGE_SIZE, 0);

      setProducts(result.items);
      setTotalCount(result.total_count);
      setHasMore(result.has_more);
      setCurrentOffset(result.items.length);
      setLastUpdated(new Date());

      console.log(`Products loaded: ${result.items.length} of ${result.total_count} items`);
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error fetching products:", error);
      // Fail-open: don't block UI with "Invalid response format"
      if (error.message && error.message.includes("Invalid response format")) {
        setError(null);
      } else {
        setError(error.message || "Unknown error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Load more products (infinite scroll)
  const loadMoreProducts = useCallback(async () => {
    if (isLoadingMore || !hasMore || searchQuery) return;

    setIsLoadingMore(true);

    try {
      const result = await fetchProductsFromAPI(LOAD_MORE_SIZE, currentOffset);

      setProducts(prev => {
        // Avoid duplicates by filtering out items that already exist
        const existingIds = new Set(prev.map(p => p.id));
        const newItems = result.items.filter(item => !existingIds.has(item.id));
        return [...prev, ...newItems];
      });

      setCurrentOffset(prev => prev + result.items.length);
      setHasMore(result.has_more);

      console.log(`Loaded ${result.items.length} more products. Total: ${currentOffset + result.items.length}`);
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error loading more products:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, currentOffset, searchQuery]);

  // Server-side search
  const searchProducts = useCallback(async (query: string) => {
    // Cancel previous search request
    if (searchAbortController.current) {
      searchAbortController.current.abort();
    }

    const trimmedQuery = query.trim();
    setSearchQuery(trimmedQuery);

    // If empty query, reset to initial products
    if (!trimmedQuery) {
      setIsSearching(false);
      fetchProducts();
      return;
    }

    setIsSearching(true);
    searchAbortController.current = new AbortController();

    try {
      // Search with larger limit to get more results
      const result = await fetchProductsFromAPI(500, 0, trimmedQuery);

      setProducts(result.items);
      setTotalCount(result.total_count);
      setHasMore(false); // Disable infinite scroll during search
      setCurrentOffset(result.items.length);

      console.log(`Search "${trimmedQuery}" found ${result.items.length} items`);
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("Error searching products:", error);
      }
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Clear search and reset to initial products
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    fetchProducts();
  }, []);

  // Background stock update
  const updateStockInBackground = async () => {
    try {
      const { updates, fetched } = await fetchStockUpdates();
      // Apply whenever the batch API succeeded — including all-zero payloads (must not preserve stale badges).
      if (!fetched) return;

      setProducts(prevProducts =>
        prevProducts.map(product => ({
          ...product,
          available:
            product.id in updates
              ? Number(updates[product.id])
              : product.available,
        }))
      );
    } catch (error) {
      console.error('Background stock update failed:', error);
    }
  };

  // Update stock for a specific item
  const updateStockOnly = useCallback((itemCode: string, newStock: number) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.id === itemCode
          ? { ...product, available: newStock }
          : product
      )
    );
    console.log(`Updated stock for ${itemCode} to ${newStock}`);
  }, []);

  // Update stock for multiple specific items (efficient for post-payment updates)
  const updateStockForItems = useCallback(async (itemCodes: string[]) => {
    if (itemCodes.length === 0) return;

    try {
      // console.log(`Updating stock for ${itemCodes.length} items:`, itemCodes);

      const itemCodesJson = JSON.stringify(itemCodes);

      const response = await fetch(
        `/api/method/klik_pos.api.item.get_items_stock_batch?item_codes=${encodeURIComponent(itemCodesJson)}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const resData = await response.json();
      // console.log('Batch stock update response:', resData);

      if (resData?.message && typeof resData.message === 'object') {
        const stockUpdates = resData.message;

        setProducts(prevProducts =>
          prevProducts.map(product => ({
            ...product,
            available:
              product.id in stockUpdates
                ? Number(stockUpdates[product.id])
                : product.available,
          }))
        );

        // console.log(`Updated stock for ${Object.keys(stockUpdates).length} items`);
      }
    } catch (error) {
      console.error('Failed to update stock for items:', error);
      // Don't throw error to avoid breaking the payment flow
    }
  }, []);

  // Update batch quantities for specific items (for real-time batch updates)
  const updateBatchQuantitiesForItems = useCallback(async (itemCodes: string[]) => {
    if (itemCodes.length === 0) return;

    try {
      // console.log(`Updating batch quantities for ${itemCodes.length} items:`, itemCodes);

      // Update batch quantities for each item individually
      const batchUpdatePromises = itemCodes.map(async (itemCode) => {
        try {
          const response = await fetch(
            `/api/method/klik_pos.api.item.get_batch_nos_with_qty?item_code=${encodeURIComponent(itemCode)}`
          );
          const resData = await response.json();
          // console.log(`Batch API response for ${itemCode}:`, resData);

          if (resData?.message && Array.isArray(resData.message)) {
            // console.log(`Valid batch data for ${itemCode}:`, resData.message);
            return { itemCode, batches: resData.message };
          }
          console.log(`No valid batch data for ${itemCode}`);
          return null;
        } catch (error) {
          console.error(`Failed to update batch quantities for ${itemCode}:`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchUpdatePromises);
      const validResults = batchResults.filter(result => result !== null);

      if (validResults.length > 0) {
        // console.log(`Updated batch quantities for ${validResults.length} items`);
        // console.log('Dispatching batchQuantitiesUpdated event with data:', validResults);
        // Trigger a custom event to notify components about batch updates
        window.dispatchEvent(new CustomEvent('batchQuantitiesUpdated', {
          detail: { updatedItems: validResults }
        }));
      } else {
        console.log('No valid batch results to dispatch');
      }
    } catch (error) {
      console.error('Failed to update batch quantities for items:', error);
    }
  }, []);

  const refetchProducts = async () => {
    // console.log("Force refreshing products...");
    await fetchProducts(true);
  };

  // Lightweight stock-only refresh - much faster than full reload
  const refreshStockOnly = async () => {
    // console.log("Refreshing stock only (lightweight)...");
    setIsRefreshingStock(true);
    try {
      const { updates, fetched } = await fetchStockUpdates();
      if (!fetched) {
        console.log('Stock refresh skipped (request failed or empty catalog)');
        return false;
      }

      setProducts(prevProducts =>
        prevProducts.map(product => ({
          ...product,
          available:
            product.id in updates
              ? Number(updates[product.id])
              : product.available,
        }))
      );

      setLastUpdated(new Date());
      return true;
    } catch (error) {
      console.error('❌ Stock-only refresh failed:', error);
      // Don't fallback to full refresh automatically - let the user decide
      console.log("Stock refresh failed - user can manually refresh if needed");
      return false; // Failed
    } finally {
      setIsRefreshingStock(false);
    }
  };

  useEffect(() => {
    // Don't fetch products until authentication is complete
    if (authLoading) {
      return;
    }

    // If not authenticated, don't fetch products
    if (!isAuthenticated) {
      setIsLoading(false);
      setError("Authentication required to load products");
      return;
    }

    // Authentication is complete, fetch products
    fetchProducts();

    // Set up periodic stock updates as fallback
    const stockUpdateInterval = setInterval(updateStockInBackground, 30000); // Every 30 seconds

    return () => {
      clearInterval(stockUpdateInterval);
    };
  }, [isAuthenticated, authLoading]);

  const value: ProductContextType = {
    products,
    isLoading,
    isLoadingMore,
    isRefreshingStock,
    isSearching,
    error,
    refetchProducts,
    refreshStockOnly,
    updateStockOnly,
    updateStockForItems,
    updateBatchQuantitiesForItems,
    loadMoreProducts,
    searchProducts,
    clearSearch,
    count: products.length,
    totalCount,
    hasMore,
    lastUpdated,
    searchQuery,
  };

  return (
    <ProductContext.Provider value={value}>
      {children}
    </ProductContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProducts() {
  const context = useContext(ProductContext);
  if (context === undefined) {
    throw new Error('useProducts must be used within a ProductProvider');
  }
  return context;
}
